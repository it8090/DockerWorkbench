package workbench

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
)

func TestWorkspaceMigrationAndPersistence(t *testing.T) {
	dir := t.TempDir()
	s, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	c, e := s.Save(ConnectParams{Connection: Connection{Name: "Existing host", Transport: "unix", Endpoint: "unix:///tmp/workbench.sock", Timeout: 15}})
	if e != nil {
		t.Fatal(e)
	}
	// Emulate a connection written before workspace support.
	if _, e = s.db.Exec("UPDATE connections SET value=json_remove(value,'$.workspaceId') WHERE id=?", c.ID); e != nil {
		t.Fatal(e)
	}
	s.Close()
	s, e = OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	legacy, e := s.Connection(c.ID)
	if e != nil || legacy.WorkspaceID != DefaultWorkspaceID || legacy.Name != c.Name {
		t.Fatalf("migration: %+v %v", legacy, e)
	}
	w, e := s.SaveWorkspace(Workspace{Name: " Demo "})
	if e != nil || w.Name != "Demo" {
		t.Fatalf("workspace: %+v %v", w, e)
	}
	if _, e = s.MoveConnection(c.ID, w.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.SetPreference("activeWorkspace", w.ID); e != nil {
		t.Fatal(e)
	}
	s.Close()
	reopened, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	cs, _ := reopened.Connections()
	ws, _ := reopened.Workspaces()
	prefs, _ := reopened.Preferences()
	if len(ws) != 2 || len(cs) != 1 || cs[0].WorkspaceID != w.ID || prefs["activeWorkspace"] != w.ID {
		t.Fatal("workspace state did not survive reopening")
	}
}

func TestWorkspaceValidationAndDeletion(t *testing.T) {
	s, e := OpenStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	w, e := s.SaveWorkspace(Workspace{Name: "Demo"})
	if e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{"", "  ", "demo"} {
		if _, e = s.SaveWorkspace(Workspace{Name: name}); e == nil {
			t.Fatalf("accepted invalid/duplicate name %q", name)
		}
	}
	if _, e = s.SaveWorkspace(Workspace{ID: "missing", Name: "Other"}); e == nil {
		t.Fatal("renamed missing workspace")
	}
	if _, e = s.SaveWorkspace(Workspace{ID: w.ID, Name: "Production"}); e != nil {
		t.Fatal(e)
	}
	c, e := s.Save(ConnectParams{Connection: Connection{Name: "Host", WorkspaceID: w.ID, Transport: "unix", Endpoint: "unix:///tmp/workbench.sock", Timeout: 15}})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.DeleteWorkspace(w.ID); e == nil {
		t.Fatal("deleted nonempty workspace")
	}
	if e = s.DeleteWorkspace(DefaultWorkspaceID); e == nil {
		t.Fatal("deleted default workspace")
	}
	if _, e = s.MoveConnection(c.ID, "missing"); e == nil {
		t.Fatal("moved into missing workspace")
	}
	if _, e = s.MoveConnection(c.ID, DefaultWorkspaceID); e != nil {
		t.Fatal(e)
	}
	if e = s.SetPreference("activeWorkspace", w.ID); e != nil {
		t.Fatal(e)
	}
	if e = s.DeleteWorkspace(w.ID); e != nil {
		t.Fatal(e)
	}
	prefs, _ := s.Preferences()
	if prefs["activeWorkspace"] != DefaultWorkspaceID {
		t.Fatal("deleted workspace left selected")
	}
	if e = s.SetPreference("activeWorkspace", w.ID); e == nil {
		t.Fatal("selected deleted workspace")
	}
}

func TestMovePreservesConnectionSecretsBindingsAndSession(t *testing.T) {
	m, c, engine, _ := setupEngine(t, true)
	secret := Secrets{Password: "test-only-secret"}
	c, e := m.Store.Save(ConnectParams{Connection: c, Secrets: secret})
	if e != nil {
		t.Fatal(e)
	}
	b := Binding{ConnectionID: c.ID, Project: "example", WorkingDirectory: filepath.Join(t.TempDir(), "compose"), Files: []string{"compose.yml"}}
	if e = m.Store.SaveBinding(b); e != nil {
		t.Fatal(e)
	}
	if _, e = m.Snapshot(context.Background(), c.ID); e != nil {
		t.Fatal(e)
	}
	session := m.sessions[c.ID]
	w, e := m.Store.SaveWorkspace(Workspace{Name: "Test workspace"})
	if e != nil {
		t.Fatal(e)
	}
	moved, e := m.Store.MoveConnection(c.ID, w.ID)
	if e != nil {
		t.Fatal(e)
	}
	expected := c
	expected.WorkspaceID = w.ID
	if moved != expected || m.Store.Secret(c.ID) != secret {
		t.Fatal("move changed connection or credentials")
	}
	bindings, e := m.Store.Bindings(c.ID)
	if e != nil || len(bindings) != 1 || bindings[0].Project != b.Project {
		t.Fatal("move lost Compose binding")
	}
	if m.sessions[c.ID] != session || engine.Writes != 0 {
		t.Fatal("move affected live Docker session")
	}
}

func TestWorkspaceImportUsesDestinationAndRejectsUnknown(t *testing.T) {
	m, c, _, _ := setupEngine(t, true)
	w, e := m.Store.SaveWorkspace(Workspace{Name: "Imported"})
	if e != nil {
		t.Fatal(e)
	}
	c.Endpoint = "https://127.0.0.1:24680"
	c.WorkspaceID = "foreign-export-id"
	raw, _ := json.Marshal(map[string]any{"connections": []Connection{c}, "workspaceId": w.ID})
	result, e := m.Dispatch(context.Background(), "connections.import", raw)
	if e != nil {
		t.Fatal(e)
	}
	imported := result.([]Connection)
	if len(imported) != 1 || imported[0].WorkspaceID != w.ID || !imported[0].ReadOnly {
		t.Fatalf("bad import: %+v", imported)
	}
	raw, _ = json.Marshal(map[string]any{"connections": []Connection{c}, "workspaceId": "missing"})
	_, e = m.Dispatch(context.Background(), "connections.import", raw)
	var failure *Failure
	if !errors.As(e, &failure) || failure.Code != "workspace_missing" {
		t.Fatalf("unknown target: %v", e)
	}
}
