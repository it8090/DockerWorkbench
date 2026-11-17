//go:build windows

package workbench

import (
	"context"
	"github.com/Microsoft/go-winio"
	"net"
)

func dialAgent() (net.Conn, error) {
	return winio.DialPipeContext(context.Background(), `\\.\pipe\openssh-ssh-agent`)
}
func dialPipe(ctx context.Context, path string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, path)
}
