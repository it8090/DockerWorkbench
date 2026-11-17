//go:build !windows

package workbench

import (
	"context"
	"net"
	"os"
)

func dialAgent() (net.Conn, error) { return net.Dial("unix", os.Getenv("SSH_AUTH_SOCK")) }
func dialPipe(context.Context, string) (net.Conn, error) {
	return nil, Fail("unsupported_platform", "Windows named pipes require Windows", nil)
}
