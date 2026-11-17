package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sync"

	"dockerworkbench/core/internal/workbench"
)

type request struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}
type response struct {
	ID      string             `json:"id,omitempty"`
	Result  any                `json:"result,omitempty"`
	Error   *workbench.Failure `json:"error,omitempty"`
	Event   string             `json:"event,omitempty"`
	Payload any                `json:"payload,omitempty"`
}

func main() {
	directory := flag.String("data-dir", "", "Application data directory")
	flag.Parse()
	if *directory == "" {
		base, e := os.UserConfigDir()
		if e != nil {
			fmt.Fprintln(os.Stderr, e)
			os.Exit(1)
		}
		*directory = filepath.Join(base, "DockerWorkbench")
	}
	store, e := workbench.OpenStore(*directory)
	if e != nil {
		fmt.Fprintln(os.Stderr, "Cannot open application store:", e)
		os.Exit(1)
	}
	defer store.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	out := make(chan response, 1024)
	var writer sync.WaitGroup
	writer.Add(1)
	go func() {
		defer writer.Done()
		encoder := json.NewEncoder(os.Stdout)
		for message := range out {
			if e := encoder.Encode(message); e != nil {
				cancel()
				return
			}
		}
	}()
	send := func(v response) {
		select {
		case out <- v:
		case <-ctx.Done():
		}
	}
	manager := workbench.NewManager(store, func(v workbench.StreamEvent) { send(response{Event: "stream", Payload: v}) })
	defer manager.Close()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	semaphore := make(chan struct{}, 32)
	var jobs sync.WaitGroup
	for scanner.Scan() {
		var req request
		if e = json.Unmarshal(scanner.Bytes(), &req); e != nil {
			send(response{Error: &workbench.Failure{Code: "invalid_request", Message: "Invalid JSON request"}})
			continue
		}
		select {
		case semaphore <- struct{}{}:
		case <-ctx.Done():
			return
		}
		jobs.Add(1)
		go func(req request) {
			defer jobs.Done()
			defer func() { <-semaphore }()
			defer func() {
				if recover() != nil {
					send(response{ID: req.ID, Error: &workbench.Failure{Code: "internal_error", Message: "Application command failed"}})
				}
			}()
			result, e := manager.Dispatch(ctx, req.Method, req.Params)
			reply := response{ID: req.ID, Result: result}
			if e != nil {
				reply.Error = workbench.ErrorValue(e)
			}
			send(reply)
		}(req)
	}
	cancel()
	jobs.Wait()
	manager.Close()
	close(out)
	writer.Wait()
}
