// An isolated acceptance-test tool. No containers or system commands execute.
package main

import (
	"context"
	"dockerworkbench/core/internal/testengine"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
)

func main() {
	path := flag.String("socket", filepath.Join(os.TempDir(), "workbench-acceptance.sock"), "Unix socket path")
	flag.Parse()
	if _, err := os.Stat(*path); err == nil {
		fmt.Fprintln(os.Stderr, "Refusing to overwrite existing socket:", *path)
		os.Exit(1)
	}
	listener, err := net.Listen("unix", *path)
	if err != nil {
		panic(err)
	}
	os.Chmod(*path, 0600)
	defer os.Remove(*path)
	server := &http.Server{Handler: testengine.New()}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	go func() { <-ctx.Done(); server.Shutdown(context.Background()) }()
	fmt.Println("In-memory acceptance fixture at unix://" + *path)
	if err = server.Serve(listener); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
}
