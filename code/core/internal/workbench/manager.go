package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/client"
)

type Session struct {
	Client     *client.Client
	SSH        *sshTransport
	Connection Connection
	Engine     TestResult
	opMu       sync.Mutex
}

func (s *Session) Close() {
	s.Client.Close()
	if s.SSH != nil {
		s.SSH.Close()
	}
}

type runningStream struct {
	cancel       context.CancelFunc
	connectionID string
	terminal     *terminalSession
}
type operationPlan struct {
	SourceDigest string      `json:"-"`
	Token        string      `json:"token"`
	ConnectionID string      `json:"connectionId"`
	Host         string      `json:"host"`
	Action       string      `json:"action"`
	Targets      []Container `json:"targets"`
	ExpiresAt    time.Time   `json:"expiresAt"`
	Binding      *Binding    `json:"binding,omitempty"`
}
type Manager struct {
	Store      *Store
	Trust      *TrustManager
	Emit       func(StreamEvent)
	mu         sync.Mutex
	streamWG   sync.WaitGroup
	sessions   map[string]*Session
	streams    map[string]runningStream
	plans      map[string]operationPlan
	connecting map[string]*sync.Mutex
	ctx        context.Context
	cancel     context.CancelFunc
}

func NewManager(store *Store, emit func(StreamEvent)) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	return &Manager{Store: store, Trust: NewTrustManager(store.Directory), Emit: emit, sessions: map[string]*Session{}, streams: map[string]runningStream{}, plans: map[string]operationPlan{}, connecting: map[string]*sync.Mutex{}, ctx: ctx, cancel: cancel}
}
func (m *Manager) Close() {
	m.cancel()
	m.mu.Lock()
	for _, stream := range m.streams {
		stream.cancel()
	}
	for _, session := range m.sessions {
		session.Close()
	}
	m.sessions = map[string]*Session{}
	m.mu.Unlock()
	m.streamWG.Wait()
}
func connectionIdentity(c Connection) string {
	raw, _ := json.Marshal(struct {
		Transport, Endpoint string
		SSH                 SSHConfig
		TLS                 TLSConfig
	}{c.Transport, c.Endpoint, c.SSH, c.TLS})
	return string(raw)
}
func mergeSecrets(a, b Secrets) Secrets {
	if a.Password == "" {
		a.Password = b.Password
	}
	if a.Passphrase == "" {
		a.Passphrase = b.Passphrase
	}
	if a.ProxyPassword == "" {
		a.ProxyPassword = b.ProxyPassword
	}
	return a
}
func (m *Manager) secretsFor(p ConnectParams) Secrets {
	if old, e := m.Store.Connection(p.Connection.ID); e == nil && connectionIdentity(old) == connectionIdentity(p.Connection) {
		return mergeSecrets(p.Secrets, m.Store.Secret(old.ID))
	}
	return p.Secrets
}
func (m *Manager) create(ctx context.Context, c Connection, sec Secrets) (*Session, error) {
	if e := c.Validate(); e != nil {
		return nil, e
	}
	opts := []client.Opt{client.WithUserAgent("DockerWorkbench/0.1.3")}
	var sshT *sshTransport
	switch c.Transport {
	case "ssh":
		var e error
		sshT, e = openSSH(ctx, c, sec, m.Trust)
		if e != nil {
			return nil, e
		}
		opts = append(opts, client.WithHost("unix:///var/run/docker.sock"), client.WithDialContext(sshT.Dial))
	case "unix":
		if !strings.HasPrefix(c.Endpoint, "unix://") {
			return nil, Fail("invalid_config", "Unix socket endpoint must start with unix://", nil)
		}
		opts = append(opts, client.WithHost("unix://"+expandPath(strings.TrimPrefix(c.Endpoint, "unix://"))))
	case "npipe":
		opts = append(opts, client.WithHost(c.Endpoint), client.WithDialContext(func(ctx context.Context, _, _ string) (net.Conn, error) {
			path := strings.TrimPrefix(c.Endpoint, "npipe://")
			return dialPipe(ctx, path)
		}))
	case "tls":
		if !strings.HasPrefix(c.Endpoint, "https://") {
			return nil, Fail("tls_required", "Remote TCP endpoints require https:// and certificate verification", nil)
		}
		opts = append(opts, client.WithHost("tcp://"+strings.TrimPrefix(c.Endpoint, "https://")), client.WithScheme("https"), client.WithTLSClientConfig(expandPath(c.TLS.CAPath), expandPath(c.TLS.CertPath), expandPath(c.TLS.KeyPath)))
	}
	cli, e := client.New(opts...)
	if e != nil {
		if sshT != nil {
			sshT.Close()
		}
		return nil, e
	}
	s := &Session{Client: cli, SSH: sshT, Connection: c}
	version, e := cli.ServerVersion(ctx, client.ServerVersionOptions{})
	if e != nil {
		s.Close()
		return nil, e
	}
	if c.APIVersion != "" {
		if !regexp.MustCompile(`^1\.\d+$`).MatchString(c.APIVersion) || compareVersions(c.APIVersion, client.MinAPIVersion) < 0 || compareVersions(c.APIVersion, client.MaxAPIVersion) > 0 || compareVersions(c.APIVersion, version.APIVersion) > 0 || (version.MinAPIVersion != "" && compareVersions(c.APIVersion, version.MinAPIVersion) < 0) {
			s.Close()
			return nil, Fail("api_incompatible", "Requested API version is outside the supported client/server range", map[string]string{"requested": c.APIVersion, "serverMin": version.MinAPIVersion, "serverMax": version.APIVersion, "clientMin": client.MinAPIVersion, "clientMax": client.MaxAPIVersion})
		}
		_ = cli.Close()
		cli, e = client.New(append(opts, client.WithAPIVersion(c.APIVersion))...)
		if e != nil {
			s.Close()
			return nil, e
		}
		s.Client = cli
	}
	s.Engine = TestResult{version.Version, cli.ClientVersion(), version.APIVersion, version.MinAPIVersion, version.Os, version.Arch}
	return s, nil
}
func compareVersions(a, b string) int {
	parse := func(s string) [2]int {
		var major, minor int
		fmt.Sscanf(s, "%d.%d", &major, &minor)
		return [2]int{major, minor}
	}
	x, y := parse(a), parse(b)
	for i := 0; i < 2; i++ {
		if x[i] < y[i] {
			return -1
		}
		if x[i] > y[i] {
			return 1
		}
	}
	return 0
}
func (m *Manager) Test(ctx context.Context, p ConnectParams) (TestResult, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(p.Connection.Timeout)*time.Second)
	defer cancel()
	s, e := m.create(ctx, p.Connection, m.secretsFor(p))
	if e != nil {
		return TestResult{}, e
	}
	defer s.Close()
	_, e = s.Client.ContainerList(ctx, client.ContainerListOptions{All: true, Limit: 1})
	return s.Engine, e
}
func (m *Manager) session(ctx context.Context, id string) (*Session, error) {
	c, e := m.Store.Connection(id)
	if e != nil {
		return nil, e
	}
	m.mu.Lock()
	existing := m.sessions[id]
	m.mu.Unlock()
	if existing != nil && reflect.DeepEqual(existing.Connection, c) {
		return existing, nil
	}
	m.mu.Lock()
	lock := m.connecting[id]
	if lock == nil {
		lock = &sync.Mutex{}
		m.connecting[id] = lock
	}
	m.mu.Unlock()
	lock.Lock()
	defer lock.Unlock()
	c, e = m.Store.Connection(id)
	if e != nil {
		return nil, e
	}
	m.mu.Lock()
	existing = m.sessions[id]
	m.mu.Unlock()
	if existing != nil && reflect.DeepEqual(existing.Connection, c) {
		return existing, nil
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(c.Timeout)*time.Second)
	defer cancel()
	s, e := m.create(ctx, c, m.Store.Secret(id))
	if e != nil {
		return nil, e
	}
	latest, latestErr := m.Store.Connection(id)
	if latestErr != nil || !reflect.DeepEqual(latest, c) {
		s.Close()
		return nil, Fail("connection_changed", "Connection changed during handshake; connect again", nil)
	}
	m.mu.Lock()
	if existing != nil {
		existing.Close()
	}
	m.sessions[id] = s
	m.mu.Unlock()
	return s, nil
}
func (m *Manager) Disconnect(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for token, plan := range m.plans {
		if plan.ConnectionID == id {
			delete(m.plans, token)
		}
	}
	for key, stream := range m.streams {
		if stream.connectionID == id {
			stream.cancel()
			delete(m.streams, key)
		}
	}
	if s := m.sessions[id]; s != nil {
		s.Close()
		delete(m.sessions, id)
	}
}
func (m *Manager) Save(p ConnectParams) (Connection, error) {
	if p.Connection.ID != "" {
		m.Disconnect(p.Connection.ID)
	}
	return m.Store.Save(p)
}
func (m *Manager) Snapshot(ctx context.Context, id string) (Snapshot, error) {
	s, e := m.session(ctx, id)
	if e != nil {
		return Snapshot{}, e
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(s.Connection.Timeout)*time.Second)
	defer cancel()
	list, e := s.Client.ContainerList(ctx, client.ContainerListOptions{All: true})
	if e != nil {
		return Snapshot{}, e
	}
	containers := []Container{}
	for _, c := range list.Items {
		name := c.ID[:min(12, len(c.ID))]
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		ports := []string{}
		for _, p := range c.Ports {
			if p.PublicPort != 0 {
				ports = append(ports, fmt.Sprintf("%s:%d → %d/%s", p.IP, p.PublicPort, p.PrivatePort, p.Type))
			} else {
				ports = append(ports, fmt.Sprintf("%d/%s", p.PrivatePort, p.Type))
			}
		}
		containers = append(containers, Container{c.ID, name, c.Image, string(c.State), c.Status, c.Labels["com.docker.compose.project"], c.Labels["com.docker.compose.service"], ports, c.Created, c.Labels})
	}
	sort.Slice(containers, func(i, j int) bool { return containers[i].Name < containers[j].Name })
	bindings, e := m.Store.Bindings(id)
	return Snapshot{id, s.Engine, containers, bindings}, e
}
func (m *Manager) Inspect(ctx context.Context, p TargetParams) (any, error) {
	s, e := m.session(ctx, p.ConnectionID)
	if e != nil {
		return nil, e
	}
	r, e := s.Client.ContainerInspect(ctx, p.ContainerID, client.ContainerInspectOptions{})
	if e != nil {
		return nil, e
	}
	return json.RawMessage(r.Raw), nil
}
func (m *Manager) Resources(ctx context.Context, id, kind string) (any, error) {
	s, e := m.session(ctx, id)
	if e != nil {
		return nil, e
	}
	switch kind {
	case "images":
		r, e := s.Client.ImageList(ctx, client.ImageListOptions{All: true})
		return r.Items, e
	case "networks":
		r, e := s.Client.NetworkList(ctx, client.NetworkListOptions{})
		return r.Items, e
	case "volumes":
		r, e := s.Client.VolumeList(ctx, client.VolumeListOptions{})
		return r.Items, e
	}
	return nil, Fail("invalid_request", "Unknown resource type", nil)
}
func toFailure(e error) *Failure {
	var failure *Failure
	if errors.As(e, &failure) {
		return failure
	}
	code := "docker_error"
	message := e.Error()
	if errors.Is(e, context.DeadlineExceeded) {
		code = "timeout"
	} else if strings.Contains(message, "unable to authenticate") {
		code = "authentication_failed"
	} else if strings.Contains(message, "permission denied") {
		code = "permission_denied"
	} else if strings.Contains(message, "API version") || strings.Contains(message, "client version") {
		code = "api_incompatible"
	}
	return &Failure{code, message, nil}
}
func (m *Manager) Plan(ctx context.Context, id, action string, ids []string) (operationPlan, error) {
	if action != "start" && action != "stop" && action != "restart" {
		return operationPlan{}, Fail("invalid_request", "Unsupported container operation", nil)
	}
	s, e := m.session(ctx, id)
	if e != nil {
		return operationPlan{}, e
	}
	if s.Connection.ReadOnly {
		return operationPlan{}, Fail("read_only", "This connection is in read-only mode", nil)
	}
	if len(ids) == 0 || len(ids) > 100 {
		return operationPlan{}, Fail("invalid_request", "Select between 1 and 100 containers", nil)
	}
	plan := operationPlan{Token: ID(), ConnectionID: id, Host: s.Connection.Name, Action: action, ExpiresAt: time.Now().Add(2 * time.Minute)}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		r, e := s.Client.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
		if e != nil {
			return plan, e
		}
		c := r.Container
		plan.Targets = append(plan.Targets, Container{ID: c.ID, Name: strings.TrimPrefix(c.Name, "/"), Image: c.Config.Image, State: string(c.State.Status)})
	}
	m.mu.Lock()
	for token, p := range m.plans {
		if time.Now().After(p.ExpiresAt) {
			delete(m.plans, token)
		}
	}
	m.plans[plan.Token] = plan
	m.mu.Unlock()
	return plan, nil
}
func (m *Manager) takePlan(token string) (operationPlan, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	plan, ok := m.plans[token]
	if !ok || time.Now().After(plan.ExpiresAt) {
		return plan, Fail("plan_expired", "Operation preview expired; review the targets again", nil)
	}
	delete(m.plans, token)
	return plan, nil
}
func (m *Manager) Execute(ctx context.Context, token string) ([]Operation, error) {
	plan, e := m.takePlan(token)
	if e != nil {
		return nil, e
	}
	if plan.Binding != nil {
		return nil, Fail("invalid_request", "Use compose.execute for this operation", nil)
	}
	s, e := m.session(ctx, plan.ConnectionID)
	if e != nil {
		return nil, e
	}
	if s.Connection.ReadOnly {
		return nil, Fail("read_only", "This connection is in read-only mode", nil)
	}
	s.opMu.Lock()
	defer s.opMu.Unlock()
	out := []Operation{}
	for _, target := range plan.Targets {
		op := Operation{ID: ID(), ConnectionID: plan.ConnectionID, Target: target.Name, Action: plan.Action, Status: "running", StartedAt: Now()}
		if e = m.Store.Record(op); e != nil {
			return out, e
		}
		request, cancel := context.WithTimeout(ctx, 60*time.Second)
		switch plan.Action {
		case "start":
			_, e = s.Client.ContainerStart(request, target.ID, client.ContainerStartOptions{})
		case "stop":
			_, e = s.Client.ContainerStop(request, target.ID, client.ContainerStopOptions{})
		case "restart":
			_, e = s.Client.ContainerRestart(request, target.ID, client.ContainerRestartOptions{})
		}
		cancel()
		op.Status = "succeeded"
		if e != nil {
			op.Status = "failed"
			op.Error = e.Error()
			var ne net.Error
			if errors.As(e, &ne) || errors.Is(e, context.DeadlineExceeded) || errors.Is(e, context.Canceled) {
				op.Status = "unknown"
			}
		} else {
			verify, cancel := context.WithTimeout(ctx, 10*time.Second)
			actual, err := s.Client.ContainerInspect(verify, target.ID, client.ContainerInspectOptions{})
			cancel()
			if err != nil {
				op.Status = "unknown"
				op.Error = err.Error()
			} else if (plan.Action == "start" || plan.Action == "restart") && !actual.Container.State.Running {
				op.Status = "failed"
				op.Error = "Container did not remain running"
			} else if plan.Action == "stop" && actual.Container.State.Running {
				op.Status = "unknown"
				op.Error = "Container is still running"
			}
		}
		op.FinishedAt = Now()
		if err := m.Store.Record(op); err != nil {
			return out, err
		}
		out = append(out, op)
	}
	return out, nil
}

func (m *Manager) ExecuteAsync(ctx context.Context, token string) (map[string]string, error) {
	m.mu.Lock()
	plan, ok := m.plans[token]
	m.mu.Unlock()
	if !ok || time.Now().After(plan.ExpiresAt) {
		return nil, Fail("plan_expired", "Operation preview expired; review the targets again", nil)
	}
	id, life, _ := m.newStream(plan.ConnectionID)
	go func() {
		results, err := m.Execute(life, token)
		for _, result := range results {
			m.Emit(StreamEvent{StreamID: id, Kind: "operation", Data: result})
		}
		m.endStream(id, err)
	}()
	return map[string]string{"streamId": id}, nil
}

// Export includes only connection metadata. Credentials and credential-presence
// markers never leave this machine.
func (m *Manager) Export() ([]Connection, error) {
	cs, e := m.Store.Connections()
	for i := range cs {
		cs[i].HasCredentials = false
	}
	return cs, e
}
func (m *Manager) Discovery() ([]Connection, error) {
	out := []Connection{}
	home, e := os.UserHomeDir()
	if e != nil {
		return out, e
	}
	defaultC := func() Connection {
		return Connection{Environment: "development", Timeout: 15, KeepAlive: 30, ReadOnly: true}
	}
	for _, endpoint := range []string{"/var/run/docker.sock", home + "/.docker/run/docker.sock", home + "/.orbstack/run/docker.sock", home + "/.colima/default/docker.sock", os.Getenv("XDG_RUNTIME_DIR") + "/docker.sock"} {
		if info, e := os.Stat(endpoint); e == nil && info.Mode()&os.ModeSocket != 0 {
			c := defaultC()
			c.Name = endpoint
			c.Transport = "unix"
			c.Endpoint = "unix://" + endpoint
			out = append(out, c)
		}
	}
	entries, _ := os.ReadDir(home + "/.docker/contexts/meta")
	for _, entry := range entries {
		raw, e := os.ReadFile(home + "/.docker/contexts/meta/" + entry.Name() + "/meta.json")
		if e != nil {
			continue
		}
		var meta struct {
			Name      string
			Endpoints map[string]struct {
				Host          string
				SkipTLSVerify bool
			}
		}
		if json.Unmarshal(raw, &meta) != nil {
			continue
		}
		endpoint := meta.Endpoints["docker"]
		c := defaultC()
		c.Name = meta.Name
		c.Endpoint = endpoint.Host
		switch {
		case strings.HasPrefix(c.Endpoint, "unix://"):
			c.Transport = "unix"
		case strings.HasPrefix(c.Endpoint, "npipe://"):
			c.Transport = "npipe"
		case strings.HasPrefix(c.Endpoint, "ssh://"):
			c.Transport = "ssh"
			u, e := parseSSHEndpoint(c.Endpoint)
			if e != nil {
				continue
			}
			c.SSH = u
		case strings.HasPrefix(c.Endpoint, "tcp://") && !endpoint.SkipTLSVerify:
			c.Transport = "tls"
			c.Endpoint = "https://" + strings.TrimPrefix(c.Endpoint, "tcp://")
			base := home + "/.docker/contexts/tls/" + entry.Name() + "/docker/"
			c.TLS = TLSConfig{base + "ca.pem", base + "cert.pem", base + "key.pem"}
		default:
			continue
		}
		out = append(out, c)
	}
	sshCandidates, e := discoverSSH()
	if e == nil {
		out = append(out, sshCandidates...)
	}
	dedup := map[string]bool{}
	unique := []Connection{}
	for _, c := range out {
		key := c.Transport + ":" + c.Endpoint + ":" + c.SSH.Host + ":" + c.SSH.User + ":" + strconv.Itoa(c.SSH.Port)
		if !dedup[key] {
			dedup[key] = true
			unique = append(unique, c)
		}
	}
	return unique, nil
}
