package workbench

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

type Failure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *Failure) Error() string                { return e.Message }
func Fail(code, message string, data any) error { return &Failure{code, message, data} }
func ID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func Now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func Decode[T any](raw json.RawMessage) (T, error) {
	var value T
	err := json.Unmarshal(raw, &value)
	if err != nil {
		return value, Fail("invalid_request", err.Error(), nil)
	}
	return value, nil
}

type SSHConfig struct {
	Host         string `json:"host"`
	Port         int    `json:"port"`
	User         string `json:"user"`
	Auth         string `json:"auth"`
	KeyPath      string `json:"keyPath"`
	Alias        string `json:"alias,omitempty"`
	ParseConfig  bool   `json:"parseConfig"`
	SocketPath   string `json:"socketPath"`
	JumpHost     string `json:"jumpHost,omitempty"`
	ProxyType    string `json:"proxyType,omitempty"`
	ProxyAddress string `json:"proxyAddress,omitempty"`
	ProxyUser    string `json:"proxyUser,omitempty"`
}
type TLSConfig struct {
	CAPath   string `json:"caPath"`
	CertPath string `json:"certPath"`
	KeyPath  string `json:"keyPath"`
}
type Connection struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspaceId"`
	Name           string    `json:"name"`
	Environment    string    `json:"environment"`
	Transport      string    `json:"transport"`
	Endpoint       string    `json:"endpoint"`
	SSH            SSHConfig `json:"ssh"`
	TLS            TLSConfig `json:"tls"`
	APIVersion     string    `json:"apiVersion"`
	Timeout        int       `json:"timeout"`
	KeepAlive      int       `json:"keepAlive"`
	ReadOnly       bool      `json:"readOnly"`
	HasCredentials bool      `json:"hasCredentials"`
}
type Secrets struct {
	Password      string `json:"password,omitempty"`
	Passphrase    string `json:"passphrase,omitempty"`
	ProxyPassword string `json:"proxyPassword,omitempty"`
}
type ConnectParams struct {
	Connection Connection `json:"connection"`
	Secrets    Secrets    `json:"secrets"`
	Remember   bool       `json:"remember"`
}
type Binding struct {
	ConnectionID     string   `json:"connectionId"`
	Project          string   `json:"project"`
	WorkingDirectory string   `json:"workingDirectory"`
	Files            []string `json:"files"`
	EnvFiles         []string `json:"envFiles"`
	Profiles         []string `json:"profiles"`
}
type Container struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Image   string            `json:"image"`
	State   string            `json:"state"`
	Status  string            `json:"status"`
	Project string            `json:"project"`
	Service string            `json:"service"`
	Ports   []string          `json:"ports"`
	Created int64             `json:"created"`
	Labels  map[string]string `json:"labels"`
}
type TestResult struct {
	Version    string `json:"version"`
	APIVersion string `json:"apiVersion"`
	ServerAPI  string `json:"serverApi"`
	MinAPI     string `json:"minApi"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
}
type Snapshot struct {
	ConnectionID string      `json:"connectionId"`
	Engine       TestResult  `json:"engine"`
	Containers   []Container `json:"containers"`
	Bindings     []Binding   `json:"bindings"`
}
type LogEntry struct {
	ConnectionID string `json:"connectionId"`
	ContainerID  string `json:"containerId"`
	Source       string `json:"source"`
	Time         string `json:"time"`
	Stream       string `json:"stream"`
	Level        string `json:"level"`
	Message      string `json:"message"`
	Seq          uint64 `json:"seq"`
}
type Operation struct {
	ID           string `json:"id"`
	ConnectionID string `json:"connectionId"`
	Target       string `json:"target"`
	Action       string `json:"action"`
	Status       string `json:"status"`
	Error        string `json:"error,omitempty"`
	StartedAt    string `json:"startedAt"`
	FinishedAt   string `json:"finishedAt,omitempty"`
}
type StreamEvent struct {
	StreamID string   `json:"streamId"`
	Kind     string   `json:"kind"`
	Data     any      `json:"data,omitempty"`
	Error    *Failure `json:"error,omitempty"`
}
type TargetParams struct {
	ConnectionID string `json:"connectionId"`
	ContainerID  string `json:"containerId"`
}

func (c Connection) Validate() error {
	if c.Name == "" {
		return Fail("invalid_config", "Connection name is required", nil)
	}
	if c.Timeout < 1 || c.Timeout > 120 {
		return Fail("invalid_config", "Timeout must be between 1 and 120 seconds", nil)
	}
	switch c.Transport {
	case "ssh":
		if c.SSH.Host == "" || c.SSH.User == "" || c.SSH.Port < 1 || c.SSH.Port > 65535 {
			return Fail("invalid_config", "SSH host, user and valid port are required", nil)
		}
	case "unix", "npipe", "tls":
		if c.Endpoint == "" {
			return Fail("invalid_config", "Endpoint is required", nil)
		}
	default:
		return Fail("invalid_config", fmt.Sprintf("Unsupported transport: %s", c.Transport), nil)
	}
	return nil
}
