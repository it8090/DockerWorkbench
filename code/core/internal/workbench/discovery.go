package workbench

import (
	"github.com/kevinburke/ssh_config"
	"net/url"
	"os"
	"os/user"
	"strconv"
	"strings"
)

func parseSSHEndpoint(endpoint string) (SSHConfig, error) {
	u, e := url.Parse(endpoint)
	if e != nil {
		return SSHConfig{}, e
	}
	port := 22
	if u.Port() != "" {
		port, e = strconv.Atoi(u.Port())
		if e != nil {
			return SSHConfig{}, e
		}
	}
	user := ""
	if u.User != nil {
		user = u.User.Username()
	}
	if user == "" {
		user = currentUsername()
	}
	return SSHConfig{Host: u.Hostname(), Port: port, User: user, Auth: "agent", ParseConfig: true, SocketPath: "/var/run/docker.sock"}, nil
}
func discoverSSH() ([]Connection, error) {
	file, e := os.Open(expandPath("~/.ssh/config"))
	if e != nil {
		return []Connection{}, nil
	}
	defer file.Close()
	config, e := ssh_config.Decode(file)
	if e != nil {
		return nil, e
	}
	out := []Connection{}
	for _, host := range config.Hosts {
		for _, pattern := range host.Patterns {
			alias := pattern.String()
			if strings.ContainsAny(alias, "*?!") {
				continue
			}
			get := func(key string) string { v, _ := config.Get(alias, key); return v }
			hostname := get("HostName")
			if hostname == "" {
				hostname = alias
			}
			port := 22
			if p := get("Port"); p != "" {
				port, _ = strconv.Atoi(p)
			}
			auth := "agent"
			key := get("IdentityFile")
			if key != "" {
				auth = "key"
			}
			out = append(out, Connection{Name: alias, Environment: "development", Transport: "ssh", Timeout: 15, KeepAlive: 30, ReadOnly: true, SSH: SSHConfig{Host: hostname, Port: port, User: defaultUsername(get("User")), Auth: auth, KeyPath: key, Alias: alias, ParseConfig: true, SocketPath: "/var/run/docker.sock"}})
		}
	}
	return out, nil
}

func currentUsername() string {
	if u, e := user.Current(); e == nil {
		return u.Username
	}
	return os.Getenv("USER")
}
func defaultUsername(value string) string {
	if value == "" {
		return currentUsername()
	}
	return value
}
