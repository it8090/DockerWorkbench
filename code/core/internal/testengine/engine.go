// Package testengine implements an isolated, in-memory Docker API fixture.
// It never starts processes or containers and is not linked into the desktop core.
package testengine

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

var API = strings.Repeat("a", 64)
var Worker = strings.Repeat("b", 64)

type Engine struct {
	mu        sync.Mutex
	states    map[string]string
	listeners map[chan any]bool
	Writes    int
}

func New() *Engine {
	return &Engine{states: map[string]string{API: "running", Worker: "exited"}, listeners: map[chan any]bool{}}
}
func (e *Engine) state(id string) string { e.mu.Lock(); defer e.mu.Unlock(); return e.states[id] }
func (e *Engine) name(id string) string {
	if id == API {
		return "workbench-acceptance-api"
	}
	return "workbench-acceptance-worker"
}
func (e *Engine) labels(id string) map[string]string {
	service := "api"
	if id == Worker {
		service = "worker"
	}
	return map[string]string{"com.docker.compose.project": "workbench-acceptance", "com.docker.compose.service": service, "workbench.fixture": "true"}
}
func (e *Engine) Summary(id string) map[string]any {
	return map[string]any{"Id": id, "Names": []string{"/" + e.name(id)}, "Image": "workbench-fixture:test", "ImageID": strings.Repeat("c", 64), "State": e.state(id), "Status": e.state(id), "Labels": e.labels(id), "Created": time.Now().Add(-time.Hour).Unix(), "Ports": []any{}}
}
func (e *Engine) sendEvent(id, action string) {
	message := map[string]any{"Type": "container", "Action": action, "Actor": map[string]any{"ID": id, "Attributes": map[string]string{"name": e.name(id)}}, "time": time.Now().Unix(), "timeNano": time.Now().UnixNano()}
	e.mu.Lock()
	defer e.mu.Unlock()
	for listener := range e.listeners {
		select {
		case listener <- message:
		default:
		}
	}
}

var prefix = regexp.MustCompile(`^/v(\d+)\.(\d+)`)

func (e *Engine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if match := prefix.FindString(path); match != "" {
		var major, minor int
		fmt.Sscanf(match, "/v%d.%d", &major, &minor)
		if major != 1 || minor > 43 {
			http.Error(w, `{"message":"client version is too new; maximum supported API version is 1.43"}`, 400)
			return
		}
		path = strings.TrimPrefix(path, match)
	}
	jsonOut := func(value any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(value)
	}
	if path == "/_ping" {
		w.Header().Set("API-Version", "1.43")
		w.Header().Set("OSType", "linux")
		w.Header().Set("Docker-Experimental", "false")
		if r.Method != "HEAD" {
			io.WriteString(w, "OK")
		}
		return
	}
	if path == "/version" {
		jsonOut(map[string]any{"Version": "24.0.9-fixture", "ApiVersion": "1.43", "MinAPIVersion": "1.24", "Os": "linux", "Arch": "amd64", "Components": []any{}, "Platform": map[string]string{"Name": "Workbench acceptance fixture"}})
		return
	}
	if path == "/containers/json" {
		jsonOut([]any{e.Summary(API), e.Summary(Worker)})
		return
	}
	if path == "/images/json" {
		jsonOut([]any{map[string]any{"Id": "sha256:" + strings.Repeat("c", 64), "RepoTags": []string{"workbench-fixture:test"}, "Size": 1024 * 1024, "Created": time.Now().Unix()}})
		return
	}
	if path == "/networks" {
		jsonOut([]any{map[string]any{"Name": "workbench-acceptance_default", "Id": strings.Repeat("d", 64), "Driver": "bridge", "Scope": "local", "Labels": map[string]string{"workbench.fixture": "true"}}})
		return
	}
	if path == "/volumes" {
		jsonOut(map[string]any{"Volumes": []any{map[string]any{"Name": "workbench-acceptance_data", "Driver": "local", "Mountpoint": "/fixture-only", "Labels": map[string]string{"workbench.fixture": "true"}}}, "Warnings": []string{}})
		return
	}
	if path == "/events" {
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(200)
		flush, _ := w.(http.Flusher)
		if flush != nil {
			flush.Flush()
		}
		channel := make(chan any, 20)
		e.mu.Lock()
		e.listeners[channel] = true
		e.mu.Unlock()
		defer func() { e.mu.Lock(); delete(e.listeners, channel); e.mu.Unlock() }()
		for {
			select {
			case <-r.Context().Done():
				return
			case event := <-channel:
				_ = json.NewEncoder(w).Encode(event)
				if flush != nil {
					flush.Flush()
				}
			}
		}
	}
	if strings.HasPrefix(path, "/exec/") {
		if strings.HasSuffix(path, "/resize") {
			w.WriteHeader(200)
			return
		}
		if strings.HasSuffix(path, "/start") {
			io.Copy(io.Discard, r.Body)
			r.Body.Close()
			conn, buffered, err := w.(http.Hijacker).Hijack()
			if err != nil {
				return
			}
			defer conn.Close()
			io.WriteString(conn, "HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
			io.WriteString(conn, "In-memory acceptance shell; no real commands execute.\r\nfixture $ ")
			buffer := make([]byte, 4096)
			var input string
			for {
				n, err := buffered.Read(buffer)
				if err != nil {
					return
				}
				io.WriteString(conn, string(buffer[:n]))
				input += string(buffer[:n])
				if strings.ContainsAny(input, "\r\n") {
					cmd := strings.TrimSpace(input)
					reply := "fixture: " + cmd
					if cmd == "pwd" {
						reply = "/acceptance-fixture"
					}
					io.WriteString(conn, "\r\n"+reply+"\r\nfixture $ ")
					input = ""
				}
			}
		}
	}
	if strings.HasPrefix(path, "/containers/") {
		parts := strings.Split(strings.TrimPrefix(path, "/containers/"), "/")
		id := parts[0]
		if id != API && id != Worker {
			http.Error(w, `{"message":"No such container"}`, 404)
			return
		}
		action := strings.Join(parts[1:], "/")
		switch action {
		case "json":
			jsonOut(map[string]any{"Id": id, "Name": "/" + e.name(id), "Created": time.Now().Format(time.RFC3339Nano), "State": map[string]any{"Status": e.state(id), "Running": e.state(id) == "running", "ExitCode": 0}, "Config": map[string]any{"Image": "workbench-fixture:test", "Tty": false, "Labels": e.labels(id)}, "HostConfig": map[string]any{"RestartPolicy": map[string]string{"Name": "no"}}, "NetworkSettings": map[string]any{"Ports": map[string]any{}}})
			return
		case "start", "stop", "restart":
			e.mu.Lock()
			e.Writes++
			if action == "stop" {
				e.states[id] = "exited"
			} else {
				e.states[id] = "running"
			}
			e.mu.Unlock()
			e.sendEvent(id, action)
			w.WriteHeader(204)
			return
		case "logs":
			w.Header().Set("Content-Type", "application/vnd.docker.raw-stream")
			w.WriteHeader(200)
			flush, _ := w.(http.Flusher)
			counter := 0
			for {
				counter++
				message := fmt.Sprintf("%s INFO acceptance fixture 中文日志 %d\n", time.Now().UTC().Format(time.RFC3339Nano), counter)
				frame := make([]byte, 8)
				frame[0] = 1
				binary.BigEndian.PutUint32(frame[4:], uint32(len([]byte(message))))
				w.Write(frame)
				w.Write([]byte(message))
				if flush != nil {
					flush.Flush()
				}
				select {
				case <-r.Context().Done():
					return
				case <-time.After(time.Second):
				}
			}
		case "stats":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(200)
			flush, _ := w.(http.Flusher)
			counter := uint64(100)
			for {
				counter++
				_ = json.NewEncoder(w).Encode(map[string]any{"read": time.Now().UTC().Format(time.RFC3339Nano), "cpu_stats": map[string]any{"cpu_usage": map[string]uint64{"total_usage": counter * 40}, "system_cpu_usage": counter * 1000, "online_cpus": 2}, "precpu_stats": map[string]any{"cpu_usage": map[string]uint64{"total_usage": (counter - 1) * 40}, "system_cpu_usage": (counter - 1) * 1000}, "memory_stats": map[string]any{"usage": 64 * 1024 * 1024, "limit": 512 * 1024 * 1024, "stats": map[string]uint64{"inactive_file": 16 * 1024 * 1024}}, "networks": map[string]any{"eth0": map[string]uint64{"rx_bytes": counter * 100, "tx_bytes": counter * 50}}})
				if flush != nil {
					flush.Flush()
				}
				if r.URL.Query().Get("stream") == "false" {
					return
				}
				select {
				case <-r.Context().Done():
					return
				case <-time.After(time.Second):
				}
			}
		case "exec":
			jsonOut(map[string]string{"Id": strings.Repeat("e", 64)})
			return
		}
	}
	http.Error(w, `{"message":"unsupported fixture endpoint"}`, 404)
}
