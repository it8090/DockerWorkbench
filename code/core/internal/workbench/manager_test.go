package workbench

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"dockerworkbench/core/internal/testengine"
)

func setupEngine(t *testing.T, readOnly bool) (*Manager, Connection, *testengine.Engine, chan StreamEvent) {
	t.Helper()
	engine := testengine.New()
	server := httptest.NewTLSServer(engine)
	t.Cleanup(server.Close)
	dir := t.TempDir()
	ca := filepath.Join(dir, "ca.pem")
	if e := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); e != nil {
		t.Fatal(e)
	}
	store, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	store.VaultGet = func(string, string) (string, error) { return "", errors.New("not found") }
	store.VaultDelete = func(string, string) error { return nil }
	events := make(chan StreamEvent, 100)
	manager := NewManager(store, func(event StreamEvent) {
		select {
		case events <- event:
		default:
		}
	})
	t.Cleanup(func() { manager.Close(); store.Close() })
	c := Connection{Name: "TLS acceptance fixture", Environment: "development", Transport: "tls", Endpoint: server.URL, TLS: TLSConfig{CAPath: ca}, Timeout: 5, KeepAlive: 30, ReadOnly: readOnly}
	c, e = store.Save(ConnectParams{Connection: c})
	if e != nil {
		t.Fatal(e)
	}
	return manager, c, engine, events
}
func TestNegotiatesOldEngineAndRejectsNewOverride(t *testing.T) {
	m, c, _, _ := setupEngine(t, false)
	result, e := m.Test(context.Background(), ConnectParams{Connection: c})
	if e != nil {
		t.Fatal(e)
	}
	if result.APIVersion != "1.43" {
		t.Fatalf("selected API %q", result.APIVersion)
	}
	c.APIVersion = "1.52"
	_, e = m.Test(context.Background(), ConnectParams{Connection: c})
	var f *Failure
	if !errors.As(e, &f) || f.Code != "api_incompatible" {
		t.Fatalf("expected compatibility error, got %v", e)
	}
}
func TestRealSDKSnapshotAndOneShotOperationPlan(t *testing.T) {
	m, c, engine, _ := setupEngine(t, false)
	snap, e := m.Snapshot(context.Background(), c.ID)
	if e != nil {
		t.Fatal(e)
	}
	if len(snap.Containers) != 2 || snap.Containers[0].Project != "workbench-acceptance" {
		t.Fatalf("bad snapshot: %+v", snap)
	}
	plan, e := m.Plan(context.Background(), c.ID, "start", []string{testengine.Worker})
	if e != nil {
		t.Fatal(e)
	}
	results, e := m.Execute(context.Background(), plan.Token)
	if e != nil || len(results) != 1 || results[0].Status != "succeeded" {
		t.Fatalf("results %v %v", results, e)
	}
	if _, e = m.Execute(context.Background(), plan.Token); e == nil {
		t.Fatal("operation token reused")
	}
	if engine.Writes != 1 {
		t.Fatalf("unexpected writes: %d", engine.Writes)
	}
	history, e := m.Store.History()
	if e != nil || len(history) != 1 {
		t.Fatalf("missing durable audit: %v %v", history, e)
	}
}
func TestReadOnlyBlocksBeforeAnyWrite(t *testing.T) {
	m, c, engine, _ := setupEngine(t, true)
	_, e := m.Plan(context.Background(), c.ID, "restart", []string{testengine.API})
	if e == nil {
		t.Fatal("read-only plan succeeded")
	}
	_, e = m.Exec(context.Background(), ExecParams{TargetParams: TargetParams{c.ID, testengine.API}, Shell: "/bin/sh"})
	if e == nil {
		t.Fatal("read-only terminal succeeded")
	}
	if engine.Writes != 0 {
		t.Fatal("read-only issued a write")
	}
}
func TestConnectionChangeInvalidatesPreview(t *testing.T) {
	m, c, engine, _ := setupEngine(t, false)
	plan, e := m.Plan(context.Background(), c.ID, "restart", []string{testengine.API})
	if e != nil {
		t.Fatal(e)
	}
	c.Name = "renamed"
	if _, e = m.Save(ConnectParams{Connection: c}); e != nil {
		t.Fatal(e)
	}
	if _, e = m.Execute(context.Background(), plan.Token); e == nil {
		t.Fatal("stale preview executed after connection edit")
	}
	if engine.Writes != 0 {
		t.Fatal("stale preview wrote")
	}
}
func TestLogsStatsAndCancellation(t *testing.T) {
	m, c, _, events := setupEngine(t, true)
	stream, e := m.Logs(context.Background(), LogsParams{ConnectionID: c.ID, ContainerIDs: []string{testengine.API}, Tail: 5})
	if e != nil {
		t.Fatal(e)
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	found := false
	for !found {
		select {
		case event := <-events:
			if event.Kind == "log" {
				line := event.Data.(LogEntry)
				if !strings.Contains(line.Message, "中文日志") || line.Level != "INFO" {
					t.Fatalf("bad decoded log: %+v", line)
				}
				found = true
			}
		case <-timer.C:
			t.Fatal("no live logs")
		}
	}
	m.CancelStream(stream["streamId"])
	stats, e := m.Stats(context.Background(), TargetParams{c.ID, testengine.API})
	if e != nil {
		t.Fatal(e)
	}
	found = false
	for !found {
		select {
		case event := <-events:
			if event.Kind == "stats" {
				sample := event.Data.(ResourceStats)
				if sample.CPU != 8 || sample.Memory != 48*1024*1024 {
					t.Fatalf("incorrect stats: %+v", sample)
				}
				found = true
			}
		case <-timer.C:
			t.Fatal("no stats")
		}
	}
	m.CancelStream(stats["streamId"])
	m.mu.Lock()
	remaining := len(m.streams)
	m.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("streams not canceled: %d", remaining)
	}
}
func TestSecretsStayOutOfSQLiteAndDoNotFollowNewHosts(t *testing.T) {
	dir := t.TempDir()
	store, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	vault := map[string]string{}
	var lock sync.Mutex
	store.VaultSet = func(_, id, secret string) error { lock.Lock(); defer lock.Unlock(); vault[id] = secret; return nil }
	store.VaultGet = func(_, id string) (string, error) {
		lock.Lock()
		defer lock.Unlock()
		if value, ok := vault[id]; ok {
			return value, nil
		}
		return "", errors.New("not found")
	}
	store.VaultDelete = func(_, id string) error { lock.Lock(); defer lock.Unlock(); delete(vault, id); return nil }
	c, e := store.Save(ConnectParams{Connection: Connection{Name: "old", Transport: "ssh", Timeout: 5, SSH: SSHConfig{Host: "old.example", User: "ops", Port: 22}}, Secrets: Secrets{Password: "secret-not-for-disk"}, Remember: true})
	if e != nil {
		t.Fatal(e)
	}
	for _, file := range []string{"workbench.sqlite", "workbench.sqlite-wal"} {
		raw, _ := os.ReadFile(filepath.Join(dir, file))
		if bytes.Contains(raw, []byte("secret-not-for-disk")) {
			t.Fatal("plaintext secret in SQLite")
		}
	}
	c.SSH.Host = "new.example"
	c, e = store.Save(ConnectParams{Connection: c})
	if e != nil {
		t.Fatal(e)
	}
	if c.HasCredentials || store.Secret(c.ID).Password != "" {
		t.Fatal("credentials followed a changed host")
	}
}
func TestLineParserAcrossUTF8Chunks(t *testing.T) {
	var lines []string
	writer := &logWriter{send: func(value string) { lines = append(lines, value) }}
	raw := []byte("中文跨帧\nplain\n")
	writer.Write(raw[:4])
	writer.Write(raw[4:8])
	writer.Write(raw[8:])
	writer.Flush()
	if len(lines) != 2 || lines[0] != "中文跨帧" {
		t.Fatalf("UTF8 corruption: %q", lines)
	}
	if ParseLevel(`{"level":"warn","message":"test"}`) != "WARN" || ParseLevel("unstructured") != "UNKNOWN" {
		t.Fatal("wrong log level")
	}
}
func TestComposeArgumentsCannotBecomeShellSyntax(t *testing.T) {
	b := Binding{Project: "test; touch /tmp/unsafe", WorkingDirectory: "/tmp/a'b", Files: []string{"compose.yml; touch /tmp/unsafe"}}
	args, e := composeArgs(b, "down")
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(strings.Join(args, " "), "--volumes") {
		t.Fatal("Down deletes volumes")
	}
	if shellQuote("a'b") != "'a'\"'\"'b'" {
		t.Fatal("unsafe POSIX quoting")
	}
	if _, e = composeArgs(b, "shell"); e == nil {
		t.Fatal("arbitrary Compose action accepted")
	}
}

func TestAsyncOperationsAndActiveStreamShutdown(t *testing.T) {
	m, c, engine, events := setupEngine(t, false)
	plan, err := m.Plan(context.Background(), c.ID, "start", []string{testengine.Worker})
	if err != nil {
		t.Fatal(err)
	}
	stream, err := m.ExecuteAsync(context.Background(), plan.Token)
	if err != nil {
		t.Fatal(err)
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	ended := false
	for !ended {
		select {
		case event := <-events:
			if event.StreamID == stream["streamId"] && event.Kind == "end" {
				if event.Error != nil {
					t.Fatal(event.Error)
				}
				ended = true
			}
		case <-timer.C:
			t.Fatal("async operation never ended")
		}
	}
	if engine.Writes != 1 {
		t.Fatal("async operation did not execute exactly once")
	}
	if _, err = m.Logs(context.Background(), LogsParams{ConnectionID: c.ID, ContainerIDs: []string{testengine.API}, Tail: 5}); err != nil {
		t.Fatal(err)
	}
	if _, err = m.Stats(context.Background(), TargetParams{c.ID, testengine.API}); err != nil {
		t.Fatal(err)
	}
	if _, err = m.Events(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { m.Close(); close(done) }()
	select {
	case <-done:
	case <-timer.C:
		t.Fatal("active streams prevented shutdown")
	}
}

func TestInteractiveTerminalInputResizeAndCancellation(t *testing.T) {
	m, c, _, events := setupEngine(t, false)
	stream, err := m.Exec(context.Background(), ExecParams{TargetParams: TargetParams{c.ID, testengine.API}, Shell: "/bin/sh", Cols: 100, Rows: 30})
	if err != nil {
		t.Fatal(err)
	}
	if err = m.ExecInput(stream["streamId"], base64.StdEncoding.EncodeToString([]byte("pwd\r"))); err != nil {
		t.Fatal(err)
	}
	if err = m.ExecResize(context.Background(), stream["streamId"], 120, 35); err != nil {
		t.Fatal(err)
	}
	timeout := time.NewTimer(5 * time.Second)
	defer timeout.Stop()
	var output strings.Builder
	for {
		select {
		case event := <-events:
			if event.Kind == "terminal" {
				raw, _ := base64.StdEncoding.DecodeString(event.Data.(string))
				output.Write(raw)
				if strings.Contains(output.String(), "/acceptance-fixture") {
					if strings.Contains(output.String(), "Detach") {
						t.Fatal("HTTP request body leaked into terminal")
					}
					m.CancelStream(stream["streamId"])
					return
				}
			}
		case <-timeout.C:
			t.Fatal("terminal did not echo command: " + output.String())
		}
	}
}

func TestInterruptedOperationsRecoverAsUnknown(t *testing.T) {
	directory := t.TempDir()
	store, err := OpenStore(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Record(Operation{ID: "interrupted", ConnectionID: "fixture", Target: "worker", Action: "restart", Status: "running", StartedAt: Now()}); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = OpenStore(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	history, err := store.History()
	if err != nil || len(history) != 1 || history[0].Status != "unknown" {
		t.Fatalf("interrupted operation not recovered: %+v %v", history, err)
	}
}

func TestColoredSpringLogsRemainFilterableAndReadable(t *testing.T) {
	raw := "\x1b[36m2026-10-27 10:00:00\x1b[0;39m \x1b[34mINFO \x1b[0;39m startup complete"
	if ParseLevel(raw) != "INFO" || strings.Contains(stripLogANSI(raw), "\x1b") {
		t.Fatal("ANSI Spring log was not normalized")
	}
}
