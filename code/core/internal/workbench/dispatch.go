package workbench

import (
	"context"
	"encoding/json"
	"os"
	"runtime"
	"strings"
)

func cleanDockerEnv(c Connection) []string {
	env := []string{}
	for _, v := range os.Environ() {
		if !strings.HasPrefix(v, "DOCKER_HOST=") && !strings.HasPrefix(v, "DOCKER_CONTEXT=") && !strings.HasPrefix(v, "DOCKER_API_VERSION=") && !strings.HasPrefix(v, "DOCKER_TLS_VERIFY=") && !strings.HasPrefix(v, "DOCKER_CERT_PATH=") {
			env = append(env, v)
		}
	}
	env = append(env, "DOCKER_HOST="+c.Endpoint)
	if c.APIVersion != "" {
		env = append(env, "DOCKER_API_VERSION="+c.APIVersion)
	}
	return env
}
func (m *Manager) Dispatch(ctx context.Context, method string, raw json.RawMessage) (result any, err error) {
	if len(raw) == 0 || string(raw) == "null" {
		raw = json.RawMessage(`{}`)
	}
	switch method {
	case "system.info":
		return map[string]any{"version": "0.1.4", "os": runtime.GOOS, "arch": runtime.GOARCH, "dataDirectory": m.Store.Directory, "languages": []string{"zh-CN", "en"}}, nil
	case "preferences.get":
		return m.Store.Preferences()
	case "preferences.set":
		p, e := Decode[struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return nil, m.Store.SetPreference(p.Key, p.Value)
	case "connections.list":
		return m.Store.Connections()
	case "workspaces.list":
		return m.Store.Workspaces()
	case "workspaces.save":
		p, e := Decode[Workspace](raw)
		if e != nil {
			return nil, e
		}
		return m.Store.SaveWorkspace(p)
	case "workspaces.delete":
		p, e := Decode[struct {
			ID string `json:"id"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return nil, m.Store.DeleteWorkspace(p.ID)
	case "connections.move":
		p, e := Decode[struct {
			ID          string `json:"id"`
			WorkspaceID string `json:"workspaceId"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return m.Store.MoveConnection(p.ID, p.WorkspaceID)
	case "connections.save":
		p, e := Decode[ConnectParams](raw)
		if e != nil {
			return nil, e
		}
		return m.Save(p)
	case "connections.test":
		p, e := Decode[ConnectParams](raw)
		if e != nil {
			return nil, e
		}
		return m.Test(ctx, p)
	case "connections.delete", "connections.disconnect":
		p, e := Decode[struct {
			ID string `json:"id"`
		}](raw)
		if e != nil {
			return nil, e
		}
		m.Disconnect(p.ID)
		if method == "connections.delete" {
			return nil, m.Store.Delete(p.ID)
		}
		return nil, nil
	case "connections.discover":
		return m.Discovery()
	case "connections.export":
		return m.Export()
	case "connections.import":
		p, e := Decode[struct {
			Connections []Connection `json:"connections"`
			WorkspaceID string       `json:"workspaceId"`
		}](raw)
		if e != nil {
			return nil, e
		}
		if len(p.Connections) > 200 {
			return nil, Fail("invalid_request", "At most 200 connections may be imported at a time", nil)
		}
		if p.WorkspaceID == "" {
			p.WorkspaceID = DefaultWorkspaceID
		}
		if e = m.Store.requireWorkspace(p.WorkspaceID); e != nil {
			return nil, e
		}
		existing, e := m.Store.Connections()
		if e != nil {
			return nil, e
		}
		identities := map[string]bool{}
		for _, c := range existing {
			identities[connectionIdentity(c)] = true
		}
		saved := []Connection{}
		for _, c := range p.Connections {
			if identities[connectionIdentity(c)] {
				continue
			}
			c.ID = ""
			c.WorkspaceID = p.WorkspaceID
			c.HasCredentials = false
			c.ReadOnly = true
			v, e := m.Store.Save(ConnectParams{Connection: c})
			if e != nil {
				return nil, e
			}
			saved = append(saved, v)
			identities[connectionIdentity(c)] = true
		}
		return saved, nil
	case "host.trust":
		p, e := Decode[struct {
			Token string `json:"token"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return nil, m.Trust.Trust(p.Token)
	case "resources.snapshot":
		p, e := Decode[struct {
			ConnectionID string `json:"connectionId"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return m.Snapshot(ctx, p.ConnectionID)
	case "resources.list":
		p, e := Decode[struct {
			ConnectionID string `json:"connectionId"`
			Kind         string `json:"kind"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return m.Resources(ctx, p.ConnectionID, p.Kind)
	case "containers.inspect":
		p, e := Decode[TargetParams](raw)
		if e != nil {
			return nil, e
		}
		return m.Inspect(ctx, p)
	case "operations.plan":
		p, e := Decode[struct {
			ConnectionID string   `json:"connectionId"`
			Action       string   `json:"action"`
			ContainerIDs []string `json:"containerIds"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return m.Plan(ctx, p.ConnectionID, p.Action, p.ContainerIDs)
	case "operations.execute":
		p, e := Decode[struct {
			Token string `json:"token"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return m.ExecuteAsync(ctx, p.Token)
	case "operations.list":
		return m.Store.History()
	case "logs.subscribe":
		p, e := Decode[LogsParams](raw)
		if e != nil {
			return nil, e
		}
		return m.Logs(ctx, p)
	case "stats.subscribe":
		p, e := Decode[TargetParams](raw)
		if e != nil {
			return nil, e
		}
		return m.Stats(ctx, p)
	case "events.subscribe":
		p, e := Decode[struct {
			ConnectionID string `json:"connectionId"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return m.Events(ctx, p.ConnectionID)
	case "stream.cancel":
		p, e := Decode[struct {
			StreamID string `json:"streamId"`
		}](raw)
		if e != nil {
			return nil, e
		}
		m.CancelStream(p.StreamID)
		return nil, nil
	case "exec.open":
		p, e := Decode[ExecParams](raw)
		if e != nil {
			return nil, e
		}
		return m.Exec(ctx, p)
	case "exec.input":
		p, e := Decode[struct {
			StreamID string `json:"streamId"`
			Data     string `json:"data"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return nil, m.ExecInput(p.StreamID, p.Data)
	case "exec.resize":
		p, e := Decode[struct {
			StreamID string `json:"streamId"`
			Cols     uint   `json:"cols"`
			Rows     uint   `json:"rows"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return nil, m.ExecResize(ctx, p.StreamID, p.Cols, p.Rows)
	case "compose.bind":
		p, e := Decode[Binding](raw)
		if e != nil {
			return nil, e
		}
		return nil, m.Store.SaveBinding(p)
	case "compose.plan":
		p, e := Decode[struct {
			ConnectionID string `json:"connectionId"`
			Project      string `json:"project"`
			Action       string `json:"action"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return m.ComposePlan(ctx, p.ConnectionID, p.Project, p.Action)
	case "compose.execute":
		p, e := Decode[struct {
			Token string `json:"token"`
		}](raw)
		if e != nil {
			return nil, e
		}
		return m.ComposeExecute(ctx, p.Token)
	default:
		return nil, Fail("method_not_found", "Unknown application command", nil)
	}
}
func ErrorValue(err error) *Failure { return toFailure(err) }
