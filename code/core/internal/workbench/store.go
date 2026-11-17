package workbench

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/zalando/go-keyring"
	_ "modernc.org/sqlite"
)

type Store struct {
	db          *sql.DB
	Directory   string
	mu          sync.RWMutex
	secrets     map[string]Secrets
	VaultSet    func(string, string, string) error
	VaultGet    func(string, string) (string, error)
	VaultDelete func(string, string) error
}

func OpenStore(directory string) (*Store, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(directory, "workbench.sqlite"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL);
 INSERT OR IGNORE INTO workspaces(id,name) VALUES('default','');
 UPDATE connections SET value=json_set(value,'$.workspaceId','default') WHERE COALESCE(json_extract(value,'$.workspaceId'),'') = '';
 CREATE TABLE IF NOT EXISTS bindings (connection_id TEXT NOT NULL, project TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(connection_id,project));
 CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,value TEXT NOT NULL,started_at TEXT NOT NULL);
 UPDATE operations SET value=json_set(value,'$.status','unknown','$.error','Application ended before the result was confirmed; refresh the engine before retrying') WHERE json_extract(value,'$.status') IN ('running','pending');
 PRAGMA user_version=2;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	_ = os.Chmod(filepath.Join(directory, "workbench.sqlite"), 0600)
	return &Store{db: db, Directory: directory, secrets: map[string]Secrets{}, VaultSet: keyring.Set, VaultGet: keyring.Get, VaultDelete: keyring.Delete}, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Connections() ([]Connection, error) {
	rows, e := s.db.Query("SELECT value FROM connections ORDER BY rowid")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Connection{}
	for rows.Next() {
		var raw string
		var c Connection
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(raw), &c); e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Store) Connection(id string) (Connection, error) {
	var raw string
	var c Connection
	e := s.db.QueryRow("SELECT value FROM connections WHERE id=?", id).Scan(&raw)
	if e != nil {
		return c, Fail("connection_missing", "Connection not found", nil)
	}
	e = json.Unmarshal([]byte(raw), &c)
	return c, e
}
func (s *Store) Save(p ConnectParams) (Connection, error) {
	c := p.Connection
	if c.WorkspaceID == "" {
		c.WorkspaceID = DefaultWorkspaceID
	}
	if e := s.requireWorkspace(c.WorkspaceID); e != nil {
		return c, e
	}
	if c.ID == "" {
		c.ID = ID()
	}
	if e := c.Validate(); e != nil {
		return c, e
	}
	old, oldErr := s.Connection(c.ID)
	identityChanged := oldErr == nil && connectionIdentity(old) != connectionIdentity(c)
	c.HasCredentials = false
	if identityChanged {
		_ = s.VaultDelete("DockerWorkbench", c.ID)
		s.mu.Lock()
		delete(s.secrets, c.ID)
		s.mu.Unlock()
		c.HasCredentials = false
	}
	supplied := p.Secrets.Password != "" || p.Secrets.Passphrase != "" || p.Secrets.ProxyPassword != ""
	if supplied {
		if p.Remember {
			b, _ := json.Marshal(p.Secrets)
			if e := s.VaultSet("DockerWorkbench", c.ID, string(b)); e != nil {
				return c, Fail("vault_unavailable", "System credential store is unavailable; save with session-only credentials instead", nil)
			}
			c.HasCredentials = true
		} else {
			c.HasCredentials = false
			_ = s.VaultDelete("DockerWorkbench", c.ID)
		}
		s.mu.Lock()
		s.secrets[c.ID] = p.Secrets
		s.mu.Unlock()
	} else if oldErr == nil && !identityChanged {
		c.HasCredentials = old.HasCredentials
	}
	raw, _ := json.Marshal(c)
	_, e := s.db.Exec("INSERT INTO connections(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", c.ID, string(raw))
	return c, e
}
func (s *Store) Secret(id string) Secrets {
	s.mu.RLock()
	sec, ok := s.secrets[id]
	s.mu.RUnlock()
	if ok {
		return sec
	}
	raw, e := s.VaultGet("DockerWorkbench", id)
	if e == nil {
		_ = json.Unmarshal([]byte(raw), &sec)
	}
	return sec
}
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	delete(s.secrets, id)
	s.mu.Unlock()
	_ = s.VaultDelete("DockerWorkbench", id)
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec("DELETE FROM bindings WHERE connection_id=?", id); e != nil {
		return e
	}
	if _, e = tx.Exec("DELETE FROM connections WHERE id=?", id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) Preferences() (map[string]string, error) {
	out := map[string]string{}
	rows, e := s.db.Query("SELECT key,value FROM preferences")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if e = rows.Scan(&k, &v); e != nil {
			return nil, e
		}
		out[k] = v
	}
	return out, rows.Err()
}
func (s *Store) SetPreference(key, value string) error {
	if key != "language" && key != "theme" && key != "layout" && key != "activeWorkspace" && key != "updates.automatic" {
		return Fail("invalid_request", "Unknown preference", nil)
	}
	if key == "updates.automatic" && value != "true" && value != "false" {
		return Fail("invalid_request", "Update preference must be true or false", nil)
	}
	if key == "activeWorkspace" {
		if e := s.requireWorkspace(value); e != nil {
			return e
		}
	}
	_, e := s.db.Exec("INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value)
	return e
}
func (s *Store) Bindings(id string) ([]Binding, error) {
	rows, e := s.db.Query("SELECT value FROM bindings WHERE connection_id=?", id)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Binding{}
	for rows.Next() {
		var raw string
		var v Binding
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(raw), &v); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) SaveBinding(b Binding) error {
	if b.Project == "" || b.ConnectionID == "" || !filepath.IsAbs(b.WorkingDirectory) || len(b.Files) == 0 {
		return Fail("invalid_binding", "Absolute working directory, project and Compose files are required", nil)
	}
	if _, e := s.Connection(b.ConnectionID); e != nil {
		return e
	}
	raw, _ := json.Marshal(b)
	_, e := s.db.Exec("INSERT INTO bindings(connection_id,project,value) VALUES(?,?,?) ON CONFLICT(connection_id,project) DO UPDATE SET value=excluded.value", b.ConnectionID, b.Project, string(raw))
	return e
}
func (s *Store) Record(v Operation) error {
	raw, _ := json.Marshal(v)
	_, e := s.db.Exec("INSERT INTO operations(id,value,started_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", v.ID, string(raw), v.StartedAt)
	return e
}
func (s *Store) History() ([]Operation, error) {
	rows, e := s.db.Query("SELECT value FROM operations ORDER BY started_at DESC LIMIT 500")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Operation{}
	for rows.Next() {
		var raw string
		var v Operation
		if e = rows.Scan(&raw); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(raw), &v); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
