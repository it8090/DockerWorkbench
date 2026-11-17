package workbench

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
func composeArgs(b Binding, action string) ([]string, error) {
	if b.WorkingDirectory == "" || len(b.Files) == 0 || b.Project == "" {
		return nil, Fail("invalid_binding", "Compose source files and working directory are required", nil)
	}
	args := []string{"compose", "--ansi", "never", "--project-name", b.Project}
	for _, p := range b.Files {
		args = append(args, "--file", p)
	}
	for _, p := range b.EnvFiles {
		args = append(args, "--env-file", p)
	}
	for _, p := range b.Profiles {
		args = append(args, "--profile", p)
	}
	switch action {
	case "pull":
		args = append(args, "pull")
	case "up":
		args = append(args, "up", "--detach")
	case "recreate":
		args = append(args, "up", "--detach", "--force-recreate")
	case "down":
		args = append(args, "down")
	case "validate":
		args = append(args, "config")
	default:
		return nil, Fail("invalid_request", "Unsupported Compose action", nil)
	}
	for _, v := range args {
		if strings.ContainsRune(v, 0) {
			return nil, Fail("invalid_binding", "Compose arguments contain a null byte", nil)
		}
	}
	return args, nil
}

type cappedWriter struct {
	mu       sync.Mutex
	buffer   bytes.Buffer
	max      int
	overflow bool
	send     func(string)
}

func (w *cappedWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	size := len(p)
	if w.buffer.Len()+size > w.max {
		w.overflow = true
	}
	if remaining := w.max - w.buffer.Len(); remaining > 0 {
		w.buffer.Write(p[:min(remaining, size)])
	}
	if w.send != nil {
		w.send(string(p))
	}
	return size, nil
}
func (m *Manager) composeRun(ctx context.Context, s *Session, b Binding, action string, output io.Writer) error {
	args, e := composeArgs(b, action)
	if e != nil {
		return e
	}
	if s.Connection.Transport == "ssh" {
		session, e := s.SSH.client.NewSession()
		if e != nil {
			return e
		}
		defer session.Close()
		remoteArgs := append([]string{"env", "-u", "DOCKER_HOST", "-u", "DOCKER_CONTEXT", "-u", "DOCKER_API_VERSION", "-u", "DOCKER_TLS_VERIFY", "-u", "DOCKER_CERT_PATH", "DOCKER_API_VERSION=" + s.Engine.APIVersion, "docker", "--host", "unix://" + s.SSH.socket}, args...)
		quoted := []string{}
		for _, arg := range remoteArgs {
			quoted = append(quoted, shellQuote(arg))
		}
		command := "cd -- " + shellQuote(b.WorkingDirectory) + " && " + strings.Join(quoted, " ")
		session.Stdout = output
		session.Stderr = output
		if action == "validate" {
			session.Stderr = io.Discard
		}
		done := make(chan error, 1)
		go func() { done <- session.Run(command) }()
		select {
		case <-ctx.Done():
			session.Close()
			return ctx.Err()
		case e := <-done:
			return e
		}
	}
	// A remote TLS endpoint has no file-execution channel. Running a local compose
	// command with remote bind mounts would create ambiguous host-path semantics.
	if s.Connection.Transport != "unix" && s.Connection.Transport != "npipe" {
		return Fail("compose_executor_unavailable", "Compose execution requires SSH or a local Docker endpoint", nil)
	}
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = b.WorkingDirectory
	cmd.Stdout = output
	cmd.Stderr = output
	if action == "validate" {
		cmd.Stderr = io.Discard
	}
	localConnection := s.Connection
	localConnection.APIVersion = s.Engine.APIVersion
	if localConnection.Transport == "unix" {
		localConnection.Endpoint = "unix://" + expandPath(strings.TrimPrefix(localConnection.Endpoint, "unix://"))
	}
	cmd.Env = cleanDockerEnv(localConnection)
	return cmd.Run()
}
func (m *Manager) ComposePlan(ctx context.Context, id, project, action string) (operationPlan, error) {
	s, e := m.session(ctx, id)
	if e != nil {
		return operationPlan{}, e
	}
	if s.Connection.ReadOnly {
		return operationPlan{}, Fail("read_only", "This connection is in read-only mode", nil)
	}
	bindings, e := m.Store.Bindings(id)
	if e != nil {
		return operationPlan{}, e
	}
	var binding *Binding
	for _, b := range bindings {
		if b.Project == project {
			copy := b
			binding = &copy
			break
		}
	}
	if binding == nil {
		return operationPlan{}, Fail("compose_source_required", "Associate the original Compose source files first", nil)
	}
	if _, e = composeArgs(*binding, action); e != nil {
		return operationPlan{}, e
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	validation := &cappedWriter{max: 4 * 1024 * 1024}
	if e = m.composeRun(ctx, s, *binding, "validate", validation); e != nil {
		return operationPlan{}, Fail("compose_validation_failed", e.Error(), nil)
	}
	if validation.overflow {
		return operationPlan{}, Fail("compose_config_too_large", "Resolved Compose configuration exceeds 4 MiB", nil)
	}
	digest := sha256.Sum256(validation.buffer.Bytes())
	snapshot, e := m.Snapshot(ctx, id)
	if e != nil {
		return operationPlan{}, e
	}
	targets := []Container{}
	for _, c := range snapshot.Containers {
		if c.Project == project {
			targets = append(targets, c)
		}
	}
	plan := operationPlan{SourceDigest: hex.EncodeToString(digest[:]), Token: ID(), ConnectionID: id, Host: s.Connection.Name, Action: action, Targets: targets, ExpiresAt: time.Now().Add(2 * time.Minute), Binding: binding}
	m.mu.Lock()
	m.plans[plan.Token] = plan
	m.mu.Unlock()
	return plan, nil
}
func (m *Manager) ComposeExecute(ctx context.Context, token string) (map[string]string, error) {
	plan, e := m.takePlan(token)
	if e != nil {
		return nil, e
	}
	if plan.Binding == nil {
		return nil, Fail("invalid_request", "Not a Compose operation", nil)
	}
	s, e := m.session(ctx, plan.ConnectionID)
	if e != nil {
		return nil, e
	}
	if s.Connection.ReadOnly {
		return nil, Fail("read_only", "This connection is in read-only mode", nil)
	}
	id, life, _ := m.newStream(plan.ConnectionID)
	go func() {
		s.opMu.Lock()
		defer s.opMu.Unlock()
		op := Operation{ID: ID(), ConnectionID: plan.ConnectionID, Target: plan.Binding.Project, Action: "compose." + plan.Action, Status: "running", StartedAt: Now()}
		if err := m.Store.Record(op); err != nil {
			m.endStream(id, err)
			return
		}
		request, cancel := context.WithTimeout(life, 10*time.Minute)
		defer cancel()
		writer := &cappedWriter{max: 4 * 1024 * 1024, send: func(text string) { m.Emit(StreamEvent{StreamID: id, Kind: "compose-output", Data: text}) }}
		validation := &cappedWriter{max: 4 * 1024 * 1024}
		e := m.composeRun(request, s, *plan.Binding, "validate", validation)
		if e == nil {
			digest := sha256.Sum256(validation.buffer.Bytes())
			if validation.overflow || hex.EncodeToString(digest[:]) != plan.SourceDigest {
				e = Fail("compose_source_changed", "Compose configuration changed after preview; review again", nil)
			}
		}
		if e == nil {
			e = m.composeRun(request, s, *plan.Binding, plan.Action, writer)
		}
		op.Status = "succeeded"
		if e != nil {
			op.Status = "failed"
			op.Error = e.Error()
			if request.Err() != nil {
				op.Status = "unknown"
			}
		}
		op.FinishedAt = Now()
		if err := m.Store.Record(op); err != nil {
			m.endStream(id, err)
			return
		}
		m.Emit(StreamEvent{StreamID: id, Kind: "operation", Data: op})
		m.endStream(id, e)
	}()
	return map[string]string{"streamId": id}, nil
}
