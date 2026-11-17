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
	"sync/atomic"
	"testing"
	"time"

	"dockerworkbench/core/internal/testengine"
	"golang.org/x/crypto/ssh"
)

func TestSSHStdioPoolHandlesMoreThanOneServerSessionLimit(t *testing.T) {
	engine := httptest.NewServer(testengine.New())
	defer engine.Close()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	var connections, opened, peak, rejected atomic.Int32
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			connections.Add(1)
			go func() {
				server, channels, requests, err := ssh.NewServerConn(conn, config)
				if err != nil {
					conn.Close()
					return
				}
				defer server.Close()
				go ssh.DiscardRequests(requests)
				var active atomic.Int32
				for channel := range channels {
					if channel.ChannelType() != "session" {
						channel.Reject(ssh.UnknownChannelType, "Unix forwarding deliberately disabled")
						continue
					}
					if active.Load() >= 6 {
						rejected.Add(1)
						channel.Reject(ssh.ResourceShortage, "fixture session limit")
						continue
					}
					accepted, requests, err := channel.Accept()
					if err != nil {
						return
					}
					active.Add(1)
					go func() {
						defer accepted.Close()
						defer active.Add(-1)
						request, ok := <-requests
						if !ok {
							return
						}
						var payload struct{ Command string }
						ssh.Unmarshal(request.Payload, &payload)
						if request.Type != "exec" || !strings.Contains(payload.Command, "--host 'unix:///fixture.sock' system dial-stdio") {
							request.Reply(false, nil)
							return
						}
						request.Reply(true, nil)
						go ssh.DiscardRequests(requests)
						upstream, err := net.Dial("tcp", strings.TrimPrefix(engine.URL, "http://"))
						if err != nil {
							return
						}
						defer upstream.Close()
						n := opened.Add(1)
						defer opened.Add(-1)
						for {
							previous := peak.Load()
							if n <= previous || peak.CompareAndSwap(previous, n) {
								break
							}
						}
						done := make(chan struct{})
						go func() { io.Copy(upstream, accepted); upstream.Close(); close(done) }()
						io.Copy(accepted, upstream)
						accepted.Close()
						upstream.Close()
						<-done
					}()
				}
			}()
		}
	}()
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	store.VaultDelete = func(string, string) error { return nil }
	events := make(chan StreamEvent, 1024)
	m := NewManager(store, func(e StreamEvent) { events <- e })
	defer m.Close()
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	number, _ := strconv.Atoi(port)
	input := ConnectParams{Connection: Connection{Name: "stdio fixture", Transport: "ssh", Timeout: 5, KeepAlive: 30, ReadOnly: true, SSH: SSHConfig{Host: "127.0.0.1", Port: number, User: "fixture", Auth: "password", SocketPath: "/fixture.sock"}}, Secrets: Secrets{Password: "fixture-only"}}
	_, err = m.Test(context.Background(), input)
	var failure *Failure
	if !errors.As(err, &failure) || failure.Code != "host_key_unknown" {
		t.Fatalf("expected fixture trust challenge: %v", err)
	}
	if err = m.Trust.Trust(failure.Data.(map[string]string)["token"]); err != nil {
		t.Fatal(err)
	}
	c, err := m.Save(input)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 20)
	for i := range ids {
		ids[i] = testengine.API
	}
	stream, err := m.Logs(context.Background(), LogsParams{ConnectionID: c.ID, ContainerIDs: ids, Tail: 1})
	if err != nil {
		t.Fatal(err)
	}
	timeout := time.NewTimer(8 * time.Second)
	defer timeout.Stop()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case event := <-events:
			if event.Error != nil {
				t.Fatalf("unexpected stream error: %+v", event.Error)
			}
		case <-ticker.C:
			if opened.Load() >= 20 {
				if connections.Load() < 4 || rejected.Load() != 0 {
					t.Fatalf("pool bypassed limits: connections=%d rejected=%d peak=%d", connections.Load(), rejected.Load(), peak.Load())
				}
				m.CancelStream(stream["streamId"])
				return
			}
		case <-timeout.C:
			t.Fatalf("merged SSH streams stalled: open=%d peak=%d rejected=%d", opened.Load(), peak.Load(), rejected.Load())
		}
	}
}
