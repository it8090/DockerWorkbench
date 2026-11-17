package workbench

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"dockerworkbench/core/internal/testengine"
	"golang.org/x/crypto/ssh"
)

func TestSSHTransportTrustAuthenticationAndDockerNegotiation(t *testing.T) {
	engine := httptest.NewServer(testengine.New())
	defer engine.Close()
	_, private, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	signer, e := ssh.NewSignerFromKey(private)
	if e != nil {
		t.Fatal(e)
	}
	config := &ssh.ServerConfig{PasswordCallback: func(metadata ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
		if metadata.User() == "fixture" && string(password) == "test-only-password" {
			return nil, nil
		}
		return nil, errors.New("invalid fixture password")
	}}
	config.AddHostKey(signer)
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer listener.Close()
	go func() {
		for {
			connection, e := listener.Accept()
			if e != nil {
				return
			}
			go func() {
				server, channels, requests, e := ssh.NewServerConn(connection, config)
				if e != nil {
					connection.Close()
					return
				}
				defer server.Close()
				go ssh.DiscardRequests(requests)
				for channel := range channels {
					if channel.ChannelType() != "direct-streamlocal@openssh.com" {
						channel.Reject(ssh.UnknownChannelType, "only fixture Unix forwarding is supported")
						continue
					}
					accepted, requests, e := channel.Accept()
					if e != nil {
						return
					}
					go ssh.DiscardRequests(requests)
					upstream, e := net.Dial("tcp", strings.TrimPrefix(engine.URL, "http://"))
					if e != nil {
						accepted.Close()
						continue
					}
					go func() {
						defer accepted.Close()
						defer upstream.Close()
						done := make(chan struct{})
						go func() { io.Copy(upstream, accepted); close(done) }()
						io.Copy(accepted, upstream)
						upstream.Close()
						accepted.Close()
						<-done
					}()
				}
			}()
		}
	}()
	store, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	m := NewManager(store, func(StreamEvent) {})
	defer m.Close()
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	portNumber, _ := strconv.Atoi(port)
	c := Connection{Name: "SSH acceptance", Transport: "ssh", Timeout: 5, KeepAlive: 30, ReadOnly: true, SSH: SSHConfig{Host: "127.0.0.1", Port: portNumber, User: "fixture", Auth: "password", SocketPath: "/fixture.sock"}}
	input := ConnectParams{Connection: c, Secrets: Secrets{Password: "test-only-password"}}
	_, e = m.Test(context.Background(), input)
	var failure *Failure
	if !errors.As(e, &failure) || failure.Code != "host_key_unknown" {
		t.Fatalf("expected unknown host challenge, got %T %v", e, e)
	}
	data := failure.Data.(map[string]string)
	if data["fingerprint"] != ssh.FingerprintSHA256(signer.PublicKey()) {
		t.Fatal("wrong host fingerprint")
	}
	if e = m.Trust.Trust(data["token"]); e != nil {
		t.Fatal(e)
	}
	result, e := m.Test(context.Background(), input)
	if e != nil {
		t.Fatal(e)
	}
	if result.APIVersion != "1.43" {
		t.Fatalf("wrong negotiated API: %+v", result)
	}
	input.Secrets.Password = "wrong"
	if _, e = m.Test(context.Background(), input); e == nil {
		t.Fatal("wrong password authenticated")
	}
	_, secondPrivate, _ := ed25519.GenerateKey(rand.Reader)
	second, _ := ssh.NewSignerFromKey(secondPrivate)
	e = m.Trust.Callback()(listener.Addr().String(), listener.Addr(), second.PublicKey())
	if !errors.As(e, &failure) || failure.Code != "host_key_changed" {
		t.Fatalf("changed host was not blocked: %v", e)
	}
}
