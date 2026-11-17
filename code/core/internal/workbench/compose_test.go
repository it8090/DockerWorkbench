package workbench

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"dockerworkbench/core/internal/testengine"
)

func TestComposeUsesBoundEndpointAndRejectsChangedSource(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX test CLI; Windows pipe requires native acceptance")
	}
	directory, err := os.MkdirTemp("", "workbench-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(directory)
	socket := filepath.Join(directory, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: testengine.New()}
	go server.Serve(listener)
	defer server.Close()
	store, err := OpenStore(filepath.Join(directory, "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	events := make(chan StreamEvent, 100)
	m := NewManager(store, func(event StreamEvent) { events <- event })
	defer m.Close()
	c, err := store.Save(ConnectParams{Connection: Connection{Name: "Compose fixture", Transport: "unix", Endpoint: "unix://" + socket, Timeout: 5, KeepAlive: 30}})
	if err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(directory, "resolved.yaml")
	os.WriteFile(config, []byte("services: {api: {image: fixture:v1}}\n"), 0600)
	bin := filepath.Join(directory, "bin")
	os.Mkdir(bin, 0700)
	// This disposable CLI only emits a fixture configuration or records arguments.
	script := "#!/bin/sh\nfor arg do last=\"$arg\"; done\nif [ \"$last\" = config ]; then /bin/cat \"$FIXTURE_CONFIG\"; else /bin/echo \"$DOCKER_HOST|$DOCKER_API_VERSION|$*\" >> \"$FIXTURE_WRITES\"; fi\n"
	os.WriteFile(filepath.Join(bin, "docker"), []byte(script), 0700)
	writes := filepath.Join(directory, "writes.txt")
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FIXTURE_CONFIG", config)
	t.Setenv("FIXTURE_WRITES", writes)
	t.Setenv("DOCKER_HOST", "tcp://unexpected.example:2375")
	t.Setenv("DOCKER_API_VERSION", "1.52")
	t.Setenv("DOCKER_CONTEXT", "unexpected")
	if err = store.SaveBinding(Binding{ConnectionID: c.ID, Project: "workbench-acceptance", WorkingDirectory: directory, Files: []string{"compose.yaml"}}); err != nil {
		t.Fatal(err)
	}
	execute := func(plan operationPlan) Operation {
		t.Helper()
		stream, err := m.ComposeExecute(context.Background(), plan.Token)
		if err != nil {
			t.Fatal(err)
		}
		var operation Operation
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		for {
			select {
			case event := <-events:
				if event.StreamID != stream["streamId"] {
					continue
				}
				if event.Kind == "operation" {
					operation = event.Data.(Operation)
				}
				if event.Kind == "end" {
					return operation
				}
			case <-timer.C:
				t.Fatal("compose operation did not finish")
			}
		}
	}
	plan, err := m.ComposePlan(context.Background(), c.ID, "workbench-acceptance", "up")
	if err != nil {
		t.Fatal(err)
	}
	if result := execute(plan); result.Status != "succeeded" {
		t.Fatalf("compose failed: %+v", result)
	}
	raw, err := os.ReadFile(writes)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(raw), c.Endpoint+"|1.43|") || strings.Contains(string(raw), "unexpected") {
		t.Fatal("compose used an unrelated Docker context")
	}
	plan, err = m.ComposePlan(context.Background(), c.ID, "workbench-acceptance", "down")
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(config, []byte("services: {api: {image: fixture:v2}}\n"), 0600)
	if result := execute(plan); result.Status != "failed" || !strings.Contains(result.Error, "changed after preview") {
		t.Fatalf("changed source was not blocked: %+v", result)
	}
	after, _ := os.ReadFile(writes)
	if string(after) != string(raw) {
		t.Fatal("changed source caused a Compose mutation")
	}
}
