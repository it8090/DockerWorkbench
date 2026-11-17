package workbench

import (
	"strings"
	"unicode/utf8"
)

const DefaultWorkspaceID = "default"

type Workspace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Store) requireWorkspace(id string) error {
	var found string
	if e := s.db.QueryRow("SELECT id FROM workspaces WHERE id=?", id).Scan(&found); e != nil {
		return Fail("workspace_missing", "Workspace not found", nil)
	}
	return nil
}

func (s *Store) Workspaces() ([]Workspace, error) {
	rows, e := s.db.Query("SELECT id,name FROM workspaces ORDER BY rowid")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		var w Workspace
		if e := rows.Scan(&w.ID, &w.Name); e != nil {
			return nil, e
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Store) SaveWorkspace(w Workspace) (Workspace, error) {
	w.Name = strings.TrimSpace(w.Name)
	if w.Name == "" || utf8.RuneCountInString(w.Name) > 60 {
		return w, Fail("workspace_name_invalid", "Workspace name must contain 1–60 characters", nil)
	}
	tx, e := s.db.Begin()
	if e != nil {
		return w, e
	}
	defer tx.Rollback()
	rows, e := tx.Query("SELECT id,name FROM workspaces")
	if e != nil {
		return w, e
	}
	found := w.ID == ""
	for rows.Next() {
		var id, name string
		if e = rows.Scan(&id, &name); e != nil {
			rows.Close()
			return w, e
		}
		if id == w.ID {
			found = true
		}
		if id != w.ID && strings.EqualFold(name, w.Name) {
			rows.Close()
			return w, Fail("workspace_name_duplicate", "A workspace with this name already exists", nil)
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return w, e
	}
	if !found {
		return w, Fail("workspace_missing", "Workspace not found", nil)
	}
	if w.ID == "" {
		w.ID = ID()
	}
	if _, e = tx.Exec("INSERT INTO workspaces(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name", w.ID, w.Name); e != nil {
		return w, e
	}
	return w, tx.Commit()
}

// Moving metadata must not rewrite credentials, bindings or live sessions.
func (s *Store) MoveConnection(id, workspaceID string) (Connection, error) {
	if e := s.requireWorkspace(workspaceID); e != nil {
		return Connection{}, e
	}
	if _, e := s.Connection(id); e != nil {
		return Connection{}, e
	}
	_, e := s.db.Exec("UPDATE connections SET value=json_set(value,'$.workspaceId',?) WHERE id=?", workspaceID, id)
	if e != nil {
		return Connection{}, e
	}
	return s.Connection(id)
}

func (s *Store) DeleteWorkspace(id string) error {
	if id == DefaultWorkspaceID {
		return Fail("workspace_default", "The default workspace cannot be deleted", nil)
	}
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var count int
	if e = tx.QueryRow("SELECT COUNT(*) FROM connections WHERE json_extract(value,'$.workspaceId')=?", id).Scan(&count); e != nil {
		return e
	}
	if count > 0 {
		return Fail("workspace_not_empty", "Move connections before deleting the workspace", nil)
	}
	if _, e = tx.Exec("DELETE FROM workspaces WHERE id=?", id); e != nil {
		return e
	}
	if _, e = tx.Exec("UPDATE preferences SET value='default' WHERE key='activeWorkspace' AND value=?", id); e != nil {
		return e
	}
	return tx.Commit()
}
