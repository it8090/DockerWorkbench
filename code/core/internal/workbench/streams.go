package workbench

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/client"
)

func (m *Manager) newStream(connectionID string) (string, context.Context, context.CancelFunc) {
	id := ID()
	ctx, cancel := context.WithCancel(m.ctx)
	m.mu.Lock()
	m.streamWG.Add(1)
	m.streams[id] = runningStream{cancel: cancel, connectionID: connectionID}
	m.mu.Unlock()
	return id, ctx, cancel
}
func (m *Manager) CancelStream(id string) {
	m.mu.Lock()
	stream, ok := m.streams[id]
	if ok {
		delete(m.streams, id)
	}
	m.mu.Unlock()
	if ok {
		stream.cancel()
		if stream.terminal != nil {
			stream.terminal.response.Close()
		}
	}
}
func (m *Manager) endStream(id string, err error) {
	defer m.streamWG.Done()
	m.CancelStream(id)
	event := StreamEvent{StreamID: id, Kind: "end"}
	if err != nil && !errorsCanceled(err) {
		event.Error = toFailure(err)
	}
	m.Emit(event)
}
func errorsCanceled(err error) bool {
	return err == context.Canceled || err == io.EOF || strings.Contains(err.Error(), "context canceled") || strings.Contains(err.Error(), "closed network connection")
}

var logLevelPattern = regexp.MustCompile(`(?i)(?:^|[\s\[\]"':,])(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)(?:$|[\s\[\]"':,])`)

var logANSI = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`)

func stripLogANSI(message string) string { return logANSI.ReplaceAllString(message, "") }

func ParseLevel(message string) string {
	message = stripLogANSI(message)
	var value map[string]any
	if json.Unmarshal([]byte(message), &value) == nil {
		for _, key := range []string{"level", "severity", "log.level"} {
			if v, ok := value[key].(string); ok {
				return strings.ToUpper(v)
			}
		}
	}
	if match := logLevelPattern.FindStringSubmatch(message); len(match) > 1 {
		if strings.EqualFold(match[1], "warning") {
			return "WARN"
		}
		return strings.ToUpper(match[1])
	}
	return "UNKNOWN"
}

type logWriter struct {
	buffer []byte
	send   func(string)
	mu     sync.Mutex
}

func (w *logWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	size := len(data)
	w.buffer = append(w.buffer, data...)
	for {
		index := bytes.IndexByte(w.buffer, '\n')
		if index < 0 {
			break
		}
		w.send(strings.TrimSuffix(string(w.buffer[:index]), "\r"))
		w.buffer = w.buffer[index+1:]
	}
	if len(w.buffer) > 1024*1024 {
		w.send(strings.ToValidUTF8(string(w.buffer), "�") + " [line split at 1 MiB]")
		w.buffer = nil
	}
	return size, nil
}
func (w *logWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.buffer) > 0 {
		w.send(strings.ToValidUTF8(string(w.buffer), "�"))
		w.buffer = nil
	}
}

type LogsParams struct {
	ConnectionID string   `json:"connectionId"`
	ContainerIDs []string `json:"containerIds"`
	Since        string   `json:"since"`
	Tail         int      `json:"tail"`
}

func (m *Manager) Logs(ctx context.Context, p LogsParams) (map[string]string, error) {
	s, e := m.session(ctx, p.ConnectionID)
	if e != nil {
		return nil, e
	}
	if len(p.ContainerIDs) == 0 || len(p.ContainerIDs) > 100 {
		return nil, Fail("invalid_request", "Select between 1 and 100 containers for logs", nil)
	}
	if p.Tail < 0 || p.Tail > 5000 {
		p.Tail = 300
	}
	id, life, _ := m.newStream(p.ConnectionID)
	var seq atomic.Uint64
	go func() {
		var wg sync.WaitGroup
		for _, containerID := range p.ContainerIDs {
			wg.Add(1)
			go func(containerID string) {
				defer wg.Done()
				defer func() {
					if recover() != nil {
						m.Emit(StreamEvent{StreamID: id, Kind: "warning", Error: &Failure{Code: "stream_failed", Message: "Log decoder failed"}})
					}
				}()
				inspect, e := s.Client.ContainerInspect(life, containerID, client.ContainerInspectOptions{})
				if e != nil {
					m.Emit(StreamEvent{StreamID: id, Kind: "warning", Error: toFailure(e)})
					return
				}
				name := strings.TrimPrefix(inspect.Container.Name, "/")
				cursor := p.Since
				for retry := 0; life.Err() == nil; retry++ {
					if retry > 0 {
						m.Emit(StreamEvent{StreamID: id, Kind: "reconnecting", Data: map[string]string{"containerId": containerID, "since": cursor}})
						delay := time.Duration(min(1<<min(retry, 5), 30)) * time.Second
						select {
						case <-life.Done():
							return
						case <-time.After(delay):
						}
					}
					reader, e := s.Client.ContainerLogs(life, containerID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Follow: true, Timestamps: true, Since: cursor, Tail: strconv.Itoa(p.Tail)})
					if e != nil {
						if life.Err() != nil {
							return
						}
						m.Emit(StreamEvent{StreamID: id, Kind: "warning", Error: toFailure(e)})
						if retry >= 3 {
							return
						}
						continue
					}
					var cursorMu sync.Mutex
					writer := func(stream string) *logWriter {
						return &logWriter{send: func(line string) {
							stamp := Now()
							message := line
							if first, rest, ok := strings.Cut(line, " "); ok {
								if _, e := time.Parse(time.RFC3339Nano, first); e == nil {
									stamp = first
									message = rest
									cursorMu.Lock()
									previous, _ := time.Parse(time.RFC3339Nano, cursor)
									current, _ := time.Parse(time.RFC3339Nano, first)
									if current.After(previous) {
										cursor = first
									}
									cursorMu.Unlock()
								}
							}
							message = stripLogANSI(message)
							m.Emit(StreamEvent{StreamID: id, Kind: "log", Data: LogEntry{p.ConnectionID, containerID, name, stamp, stream, ParseLevel(message), message, seq.Add(1)}})
						}}
					}
					stdout, stderr := writer("stdout"), writer("stderr")
					if inspect.Container.Config != nil && inspect.Container.Config.Tty {
						_, e = io.Copy(stdout, reader)
					} else {
						_, e = stdcopy.StdCopy(stdout, stderr, reader)
					}
					stdout.Flush()
					stderr.Flush()
					reader.Close()
					if life.Err() != nil {
						return
					}
					if e == nil || e == io.EOF {
						return
					}
					m.Emit(StreamEvent{StreamID: id, Kind: "gap", Error: toFailure(e)})
					if retry >= 3 {
						return
					}
				}
			}(containerID)
		}
		wg.Wait()
		m.endStream(id, nil)
	}()
	return map[string]string{"streamId": id}, nil
}
func (m *Manager) Events(ctx context.Context, id string) (map[string]string, error) {
	s, e := m.session(ctx, id)
	if e != nil {
		return nil, e
	}
	streamID, life, _ := m.newStream(id)
	go func() {
		cursor := ""
		for life.Err() == nil {
			result := s.Client.Events(life, client.EventsListOptions{Since: cursor})
			retry := false
			for !retry {
				select {
				case <-life.Done():
					m.endStream(streamID, nil)
					return
				case event, ok := <-result.Messages:
					if !ok {
						retry = true
						break
					}
					cursor = strconv.FormatInt(event.Time, 10)
					m.Emit(StreamEvent{StreamID: streamID, Kind: "docker-event", Data: event})
				case err := <-result.Err:
					if err != nil && life.Err() == nil {
						m.Emit(StreamEvent{StreamID: streamID, Kind: "gap", Error: toFailure(err)})
					}
					retry = true
				}
			}
			select {
			case <-life.Done():
				m.endStream(streamID, nil)
				return
			case <-time.After(3 * time.Second):
			}
		}
		m.endStream(streamID, nil)
	}()
	return map[string]string{"streamId": streamID}, nil
}

type cpuStats struct {
	Usage struct {
		Total  uint64   `json:"total_usage"`
		PerCPU []uint64 `json:"percpu_usage"`
	} `json:"cpu_usage"`
	System uint64 `json:"system_cpu_usage"`
	Online uint32 `json:"online_cpus"`
}
type statsResponse struct {
	Read     string   `json:"read"`
	CPU      cpuStats `json:"cpu_stats"`
	Previous cpuStats `json:"precpu_stats"`
	Memory   struct {
		Usage uint64            `json:"usage"`
		Limit uint64            `json:"limit"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RX uint64 `json:"rx_bytes"`
		TX uint64 `json:"tx_bytes"`
	} `json:"networks"`
}
type ResourceStats struct {
	ContainerID string  `json:"containerId"`
	Time        string  `json:"time"`
	CPU         float64 `json:"cpu"`
	Memory      uint64  `json:"memory"`
	MemoryLimit uint64  `json:"memoryLimit"`
	RX          uint64  `json:"rx"`
	TX          uint64  `json:"tx"`
}

func calculateStats(id string, v statsResponse) ResourceStats {
	out := ResourceStats{ContainerID: id, Time: v.Read, Memory: v.Memory.Usage, MemoryLimit: v.Memory.Limit}
	cache := v.Memory.Stats["inactive_file"]
	if cache == 0 {
		cache = v.Memory.Stats["total_inactive_file"]
	}
	if cache <= out.Memory {
		out.Memory -= cache
	}
	if v.Previous.System > 0 && v.CPU.System > v.Previous.System && v.CPU.Usage.Total >= v.Previous.Usage.Total {
		cores := v.CPU.Online
		if cores == 0 {
			cores = uint32(len(v.CPU.Usage.PerCPU))
		}
		if cores == 0 {
			cores = 1
		}
		out.CPU = float64(v.CPU.Usage.Total-v.Previous.Usage.Total) / float64(v.CPU.System-v.Previous.System) * float64(cores) * 100
	}
	for _, n := range v.Networks {
		out.RX += n.RX
		out.TX += n.TX
	}
	return out
}
func (m *Manager) Stats(ctx context.Context, p TargetParams) (map[string]string, error) {
	s, e := m.session(ctx, p.ConnectionID)
	if e != nil {
		return nil, e
	}
	id, life, _ := m.newStream(p.ConnectionID)
	go func() {
		response, e := s.Client.ContainerStats(life, p.ContainerID, client.ContainerStatsOptions{Stream: true})
		if e != nil {
			m.endStream(id, e)
			return
		}
		defer response.Body.Close()
		decoder := json.NewDecoder(response.Body)
		var previous *statsResponse
		for {
			var sample statsResponse
			if e = decoder.Decode(&sample); e != nil {
				m.endStream(id, e)
				return
			}
			if previous != nil && sample.Previous.System == 0 {
				sample.Previous = previous.CPU
			}
			m.Emit(StreamEvent{StreamID: id, Kind: "stats", Data: calculateStats(p.ContainerID, sample)})
			previous = &sample
		}
	}()
	return map[string]string{"streamId": id}, nil
}

type terminalSession struct {
	execID   string
	response client.ExecAttachResult
	client   *client.Client
	mu       sync.Mutex
}
type ExecParams struct {
	TargetParams
	Shell string `json:"shell"`
	Cols  uint   `json:"cols"`
	Rows  uint   `json:"rows"`
}

func (m *Manager) Exec(ctx context.Context, p ExecParams) (map[string]string, error) {
	s, e := m.session(ctx, p.ConnectionID)
	if e != nil {
		return nil, e
	}
	if s.Connection.ReadOnly {
		return nil, Fail("read_only", "Interactive terminal is disabled for read-only connections", nil)
	}
	if p.Shell != "/bin/sh" && p.Shell != "/bin/bash" && p.Shell != "sh" && p.Shell != "bash" {
		return nil, Fail("invalid_request", "Choose /bin/sh or /bin/bash", nil)
	}
	created, e := s.Client.ExecCreate(ctx, p.ContainerID, client.ExecCreateOptions{Cmd: []string{p.Shell}, AttachStdin: true, AttachStdout: true, AttachStderr: true, TTY: true, ConsoleSize: client.ConsoleSize{Height: p.Rows, Width: p.Cols}})
	if e != nil {
		return nil, e
	}
	id, life, cancel := m.newStream(p.ConnectionID)
	response, e := s.Client.ExecAttach(life, created.ID, client.ExecAttachOptions{TTY: true, ConsoleSize: client.ConsoleSize{Height: p.Rows, Width: p.Cols}})
	if e != nil {
		cancel()
		m.endStream(id, e)
		return nil, e
	}
	terminal := &terminalSession{execID: created.ID, response: response, client: s.Client}
	m.mu.Lock()
	stream := m.streams[id]
	stream.terminal = terminal
	m.streams[id] = stream
	m.mu.Unlock()
	go func() {
		defer response.Close()
		buffer := make([]byte, 16*1024)
		for {
			n, e := response.Reader.Read(buffer)
			if n > 0 {
				m.Emit(StreamEvent{StreamID: id, Kind: "terminal", Data: base64.StdEncoding.EncodeToString(buffer[:n])})
			}
			if e != nil {
				m.endStream(id, e)
				return
			}
		}
	}()
	go func() { <-life.Done(); response.Close() }()
	return map[string]string{"streamId": id, "execId": created.ID}, nil
}
func (m *Manager) ExecInput(id, data string) error {
	m.mu.Lock()
	stream := m.streams[id]
	m.mu.Unlock()
	if stream.terminal == nil {
		return Fail("stream_missing", "Terminal session is closed", nil)
	}
	raw, e := base64.StdEncoding.DecodeString(data)
	if e != nil {
		return e
	}
	if len(raw) > 64*1024 {
		return Fail("invalid_request", "Terminal input is too large", nil)
	}
	stream.terminal.mu.Lock()
	defer stream.terminal.mu.Unlock()
	_, e = stream.terminal.response.Conn.Write(raw)
	return e
}
func (m *Manager) ExecResize(ctx context.Context, id string, cols, rows uint) error {
	m.mu.Lock()
	stream := m.streams[id]
	m.mu.Unlock()
	if stream.terminal == nil {
		return Fail("stream_missing", "Terminal session is closed", nil)
	}
	if cols < 1 || rows < 1 || cols > 1000 || rows > 1000 {
		return Fail("invalid_request", "Invalid terminal size", nil)
	}
	_, e := stream.terminal.client.ExecResize(ctx, stream.terminal.execID, client.ExecResizeOptions{Width: cols, Height: rows})
	return e
}
