package workbench

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kevinburke/ssh_config"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
	"golang.org/x/net/proxy"
)

func expandPath(value string) string {
	if strings.HasPrefix(value, "~/") {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, value[2:])
	}
	return value
}
func resolveSSH(c Connection) (SSHConfig, error) {
	s := c.SSH
	if s.SocketPath == "" {
		s.SocketPath = "/var/run/docker.sock"
	}
	if s.Port == 0 {
		s.Port = 22
	}
	if s.ParseConfig {
		alias := s.Alias
		if alias == "" {
			alias = s.Host
		}
		if cmd := ssh_config.Get(alias, "ProxyCommand"); cmd != "" && cmd != "none" {
			return s, Fail("ssh_config_unsupported", "ProxyCommand execution is not supported; use an explicit jump host or proxy", nil)
		}
		if s.Host == alias {
			if v := ssh_config.Get(alias, "HostName"); v != "" {
				s.Host = v
			}
		}
		if s.User == "" {
			s.User = ssh_config.Get(alias, "User")
		}
		if v := ssh_config.Get(alias, "Port"); v != "" && c.SSH.Port == 0 {
			s.Port, _ = strconv.Atoi(v)
		}
		if s.KeyPath == "" {
			s.KeyPath = ssh_config.Get(alias, "IdentityFile")
		}
		if s.JumpHost == "" {
			s.JumpHost = ssh_config.Get(alias, "ProxyJump")
		}
	}
	if s.Host == "" || s.User == "" || strings.ContainsAny(s.Host, "\r\n/ ") || s.Port < 1 || s.Port > 65535 {
		return s, Fail("invalid_config", "Invalid SSH host, port or user", nil)
	}
	return s, nil
}

type trustChallenge struct {
	Address string
	Key     ssh.PublicKey
	Expires time.Time
}
type TrustManager struct {
	mu      sync.Mutex
	pending map[string]trustChallenge
	path    string
}

func NewTrustManager(directory string) *TrustManager {
	return &TrustManager{pending: map[string]trustChallenge{}, path: filepath.Join(directory, "known_hosts")}
}
func (t *TrustManager) Callback() ssh.HostKeyCallback {
	files := []string{}
	for _, path := range []string{t.path, expandPath("~/.ssh/known_hosts")} {
		if _, err := os.Stat(path); err == nil {
			files = append(files, path)
		}
	}
	var verify ssh.HostKeyCallback
	var verifyError error
	if len(files) > 0 {
		verify, verifyError = knownhosts.New(files...)
	}
	return func(address string, remote net.Addr, key ssh.PublicKey) error {
		if verifyError != nil {
			return Fail("host_key_file_invalid", "Cannot parse known_hosts: "+verifyError.Error(), nil)
		}
		if verify != nil {
			err := verify(address, remote, key)
			if err == nil {
				return nil
			}
			if k, ok := err.(*knownhosts.KeyError); !ok || len(k.Want) > 0 {
				return Fail("host_key_changed", "SSH host key changed; connection blocked. Verify the fingerprint outside this application before updating known_hosts", map[string]string{"address": address, "fingerprint": ssh.FingerprintSHA256(key)})
			}
		}
		token := ID()
		t.mu.Lock()
		for k, p := range t.pending {
			if time.Now().After(p.Expires) {
				delete(t.pending, k)
			}
		}
		t.pending[token] = trustChallenge{address, key, time.Now().Add(5 * time.Minute)}
		t.mu.Unlock()
		return Fail("host_key_unknown", "Verify the SSH host fingerprint before trusting this server", map[string]string{"token": token, "address": address, "fingerprint": ssh.FingerprintSHA256(key), "algorithm": key.Type()})
	}
}
func (t *TrustManager) Trust(token string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	p, ok := t.pending[token]
	if !ok || time.Now().After(p.Expires) {
		return Fail("trust_expired", "Host-key challenge expired; test the connection again", nil)
	}
	delete(t.pending, token)
	f, e := os.OpenFile(t.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	_, e = fmt.Fprintln(f, knownhosts.Line([]string{knownhosts.Normalize(p.Address)}, p.Key))
	return e
}

type sshTransport struct {
	client    *ssh.Client
	jump      *sshTransport
	agentConn net.Conn
	cancel    context.CancelFunc
	socket    string
	poolMu    sync.Mutex
	children  []*sshTransport
	usage     map[*sshTransport]int
	factory   func(context.Context) (*sshTransport, error)
	closed    bool
	stdioOnly bool
	closeOnce sync.Once
}

func (s *sshTransport) Close() {
	s.closeOnce.Do(func() {
		s.cancel()
		s.poolMu.Lock()
		s.closed = true
		children := append([]*sshTransport(nil), s.children...)
		s.poolMu.Unlock()
		s.client.Close()
		for _, child := range children {
			child.Close()
		}
		if s.jump != nil {
			s.jump.Close()
		}
		if s.agentConn != nil {
			s.agentConn.Close()
		}
	})
}
func (s *sshTransport) reserveStdio(ctx context.Context) (*sshTransport, func(), error) {
	s.poolMu.Lock()
	defer s.poolMu.Unlock()
	if s.closed {
		return nil, nil, net.ErrClosed
	}
	var selected *sshTransport
	candidates := append([]*sshTransport{s}, s.children...)
	for _, candidate := range candidates {
		if s.usage[candidate] < 6 {
			selected = candidate
			break
		}
	}
	if selected == nil {
		if len(s.children) >= 7 {
			return nil, nil, Fail("ssh_stream_capacity", "SSH fallback supports up to 48 simultaneous HTTP channels; reduce active log sources", nil)
		}
		child, err := s.factory(ctx)
		if err != nil {
			return nil, nil, err
		}
		s.children = append(s.children, child)
		selected = child
	}
	s.usage[selected]++
	var once sync.Once
	release := func() { once.Do(func() { s.poolMu.Lock(); s.usage[selected]--; s.poolMu.Unlock() }) }
	return selected, release, nil
}
func authMethods(s SSHConfig, secret Secrets) ([]ssh.AuthMethod, net.Conn, error) {
	methods := []ssh.AuthMethod{}
	var agentConn net.Conn
	if s.Auth == "password" {
		if secret.Password == "" {
			return nil, nil, Fail("credentials_required", "SSH password is required", nil)
		}
		methods = append(methods, ssh.Password(secret.Password))
	}
	if s.Auth == "key" {
		if s.KeyPath == "" {
			return nil, nil, Fail("credentials_required", "SSH private-key path is required", nil)
		}
		raw, e := os.ReadFile(expandPath(s.KeyPath))
		if e != nil {
			return nil, nil, Fail("key_unavailable", "Private key cannot be read: "+e.Error(), nil)
		}
		var signer ssh.Signer
		if secret.Passphrase != "" {
			signer, e = ssh.ParsePrivateKeyWithPassphrase(raw, []byte(secret.Passphrase))
		} else {
			signer, e = ssh.ParsePrivateKey(raw)
		}
		for i := range raw {
			raw[i] = 0
		}
		if e != nil {
			return nil, nil, Fail("key_unavailable", "Private key is encrypted, invalid, or in an unsupported format", nil)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}
	if s.Auth == "agent" || s.Auth == "" {
		var e error
		agentConn, e = dialAgent()
		if e != nil {
			return nil, nil, Fail("agent_unavailable", "SSH agent is not available: "+e.Error(), nil)
		}
		methods = append(methods, ssh.PublicKeysCallback(agent.NewClient(agentConn).Signers))
	}
	return methods, agentConn, nil
}
func dialViaProxy(ctx context.Context, s SSHConfig, secret Secrets, target string, timeout time.Duration) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	switch s.ProxyType {
	case "", "none":
		return dialer.DialContext(ctx, "tcp", target)
	case "socks5":
		var auth *proxy.Auth
		if s.ProxyUser != "" {
			auth = &proxy.Auth{User: s.ProxyUser, Password: secret.ProxyPassword}
		}
		d, e := proxy.SOCKS5("tcp", s.ProxyAddress, auth, dialer)
		if e != nil {
			return nil, e
		}
		if cd, ok := d.(proxy.ContextDialer); ok {
			return cd.DialContext(ctx, "tcp", target)
		}
		return nil, Fail("proxy_failed", "Proxy does not support context cancellation", nil)
	case "http":
		conn, e := dialer.DialContext(ctx, "tcp", s.ProxyAddress)
		if e != nil {
			return nil, e
		}
		_ = conn.SetDeadline(time.Now().Add(timeout))
		req := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n", target, target)
		if s.ProxyUser != "" {
			req += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(s.ProxyUser+":"+secret.ProxyPassword)) + "\r\n"
		}
		_, e = io.WriteString(conn, req+"\r\n")
		if e != nil {
			conn.Close()
			return nil, e
		}
		reader := bufio.NewReader(conn)
		resp, e := http.ReadResponse(reader, &http.Request{Method: "CONNECT"})
		if e != nil {
			conn.Close()
			return nil, e
		}
		if resp.StatusCode != 200 {
			conn.Close()
			return nil, Fail("proxy_failed", "HTTP proxy rejected the CONNECT request", nil)
		}
		_ = conn.SetDeadline(time.Time{})
		return &bufferedConn{Conn: conn, reader: reader}, nil
	default:
		return nil, Fail("invalid_config", "Unsupported proxy type", nil)
	}
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(b []byte) (int, error) { return c.reader.Read(b) }
func openSSH(ctx context.Context, c Connection, secret Secrets, trust *TrustManager) (*sshTransport, error) {
	cfg, e := resolveSSH(c)
	if e != nil {
		return nil, e
	}
	timeout := time.Duration(c.Timeout) * time.Second
	methods, agentConn, e := authMethods(cfg, secret)
	if e != nil {
		return nil, e
	}
	cleanup := func() {
		if agentConn != nil {
			agentConn.Close()
		}
	}
	address := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	var conn net.Conn
	var jump *sshTransport
	if cfg.JumpHost != "" && cfg.JumpHost != "none" {
		if strings.Contains(cfg.JumpHost, ",") {
			cleanup()
			return nil, Fail("ssh_config_unsupported", "Multiple jump hosts are not supported in this release", nil)
		}
		alias := cfg.JumpHost
		jumpUser := ""
		if at := strings.LastIndex(alias, "@"); at >= 0 {
			jumpUser = alias[:at]
			alias = alias[at+1:]
		}
		jc := c
		jc.SSH = SSHConfig{Host: alias, Alias: alias, User: jumpUser, Auth: "agent", ParseConfig: true, SocketPath: cfg.SocketPath}
		if jc.SSH.User == "" {
			jc.SSH.User = ssh_config.Get(alias, "User")
		}
		if key := ssh_config.Get(alias, "IdentityFile"); key != "" {
			jc.SSH.Auth = "key"
			jc.SSH.KeyPath = key
		}
		jc.SSH.JumpHost = "none"
		j, e := openSSH(ctx, jc, Secrets{}, trust)
		if e != nil {
			cleanup()
			return nil, e
		}
		jump = j
		conn, e = jump.client.DialContext(ctx, "tcp", address)
		if e != nil {
			j.Close()
			cleanup()
			return nil, e
		}
	} else {
		conn, e = dialViaProxy(ctx, cfg, secret, address, timeout)
		if e != nil {
			cleanup()
			return nil, Fail("network_failed", e.Error(), nil)
		}
	}
	stopCancel := context.AfterFunc(ctx, func() { conn.Close() })
	_ = conn.SetDeadline(time.Now().Add(timeout))
	sc, channels, requests, e := ssh.NewClientConn(conn, address, &ssh.ClientConfig{User: cfg.User, Auth: methods, HostKeyCallback: trust.Callback(), Timeout: timeout})
	stopCancel()
	if e != nil {
		conn.Close()
		if jump != nil {
			jump.Close()
		}
		cleanup()
		return nil, e
	}
	_ = conn.SetDeadline(time.Time{})
	client := ssh.NewClient(sc, channels, requests)
	life, cancel := context.WithCancel(context.Background())
	transport := &sshTransport{client: client, jump: jump, agentConn: agentConn, cancel: cancel, socket: cfg.SocketPath, usage: map[*sshTransport]int{}}
	transport.factory = func(request context.Context) (*sshTransport, error) {
		request, done := context.WithTimeout(request, timeout)
		defer done()
		return openSSH(request, c, secret, trust)
	}
	interval := c.KeepAlive
	if interval < 5 {
		interval = 30
	}
	go func() {
		ticker := time.NewTicker(time.Duration(interval) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-life.Done():
				return
			case <-ticker.C:
				if _, _, e := client.SendRequest("keepalive@openssh.com", true, nil); e != nil {
					client.Close()
					return
				}
			}
		}
	}()
	return transport, nil
}
func (s *sshTransport) Dial(ctx context.Context, _, _ string) (net.Conn, error) {
	s.poolMu.Lock()
	stdioOnly, closed := s.stdioOnly, s.closed
	s.poolMu.Unlock()
	if closed {
		return nil, net.ErrClosed
	}
	if !stdioOnly {
		conn, err := s.client.DialContext(ctx, "unix", s.socket)
		if err == nil {
			return conn, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		s.poolMu.Lock()
		s.stdioOnly = true
		s.poolMu.Unlock()
	}
	// Bound concurrent exec sessions below OpenSSH's usual per-connection limit.
	// Additional authenticated connections keep merged logs independent.
	selected, release, err := s.reserveStdio(ctx)
	if err != nil {
		return nil, err
	}
	session, err := selected.client.NewSession()
	if err != nil {
		release()
		return nil, err
	}
	fail := func(e error) (net.Conn, error) { session.Close(); release(); return nil, e }
	in, err := session.StdinPipe()
	if err != nil {
		return fail(err)
	}
	out, err := session.StdoutPipe()
	if err != nil {
		return fail(err)
	}
	session.Stderr = io.Discard
	command := "env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_API_VERSION -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host " + shellQuote("unix://"+s.socket) + " system dial-stdio"
	if err = session.Start(command); err != nil {
		return fail(err)
	}
	conn := &stdioConn{session: session, in: in, out: out, release: release}
	go func() {
		select {
		case <-ctx.Done():
		case <-sessionDone(session):
		}
		conn.Close()
	}()
	return conn, nil
}
func sessionDone(s *ssh.Session) <-chan struct{} {
	done := make(chan struct{})
	go func() { _ = s.Wait(); close(done) }()
	return done
}

type stdioConn struct {
	session *ssh.Session
	in      io.WriteCloser
	out     io.Reader
	once    sync.Once
	release func()
}

func (s *stdioConn) Read(b []byte) (int, error)  { return s.out.Read(b) }
func (s *stdioConn) Write(b []byte) (int, error) { return s.in.Write(b) }
func (s *stdioConn) Close() error {
	s.once.Do(func() {
		s.in.Close()
		s.session.Close()
		if s.release != nil {
			s.release()
		}
	})
	return nil
}

type sshAddr string

func (s sshAddr) Network() string                     { return "ssh" }
func (s sshAddr) String() string                      { return string(s) }
func (s *stdioConn) LocalAddr() net.Addr              { return sshAddr("local") }
func (s *stdioConn) RemoteAddr() net.Addr             { return sshAddr("docker") }
func (s *stdioConn) SetDeadline(time.Time) error      { return nil }
func (s *stdioConn) SetReadDeadline(time.Time) error  { return nil }
func (s *stdioConn) SetWriteDeadline(time.Time) error { return nil }
