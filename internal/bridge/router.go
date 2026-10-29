// Package bridge maps the Electron preload channel surface onto Go handlers.
package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// ErrUnknownChannel means no Go handler was registered for the requested channel.
var ErrUnknownChannel = errors.New("unknown bridge channel")

// Handler receives already-parsed JSON arguments and returns a JSON-serialisable value.
type Handler func(ctx context.Context, args []json.RawMessage) (any, error)

// Router is a concurrency-safe channel registry.
type Router struct {
	mu       sync.RWMutex
	handlers map[string]Handler
}

// NewRouter returns an empty registry.
func NewRouter() *Router {
	return &Router{handlers: make(map[string]Handler)}
}

// Handle registers a handler. Duplicate registration panics: channel names must be unique.
func (r *Router) Handle(channel string, h Handler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.handlers[channel]; exists {
		panic("duplicate bridge channel: " + channel)
	}
	r.handlers[channel] = h
}

// Has reports whether a channel is registered. Used by parity tests.
func (r *Router) Has(channel string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.handlers[channel]
	return ok
}

// Channels lists registered channel names (unordered).
func (r *Router) Channels() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.handlers))
	for name := range r.handlers {
		out = append(out, name)
	}
	return out
}

// Invoke decodes and dispatches one call.
func (r *Router) Invoke(ctx context.Context, channel string, args []json.RawMessage) (any, error) {
	r.mu.RLock()
	h, ok := r.handlers[channel]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownChannel, channel)
	}
	return h(ctx, args)
}

// DecodeArg unmarshals the positional argument at index.
func DecodeArg[T any](args []json.RawMessage, index int) (T, error) {
	var zero T
	if index >= len(args) {
		return zero, fmt.Errorf("missing argument %d", index)
	}
	if err := json.Unmarshal(args[index], &zero); err != nil {
		return zero, fmt.Errorf("argument %d: %w", index, err)
	}
	return zero, nil
}
