package bridge

import (
	"context"
	"encoding/json"
)

// Service is the single Wails binding exposed to every renderer.
// JS calls it as bridge.Service.Invoke(channel, args).
type Service struct {
	router *Router
}

// NewService wraps a router for binding.
func NewService(r *Router) *Service { return &Service{router: r} }

// Invoke is the only exported binding method. args must be a JSON array.
func (s *Service) Invoke(channel string, args []json.RawMessage) (any, error) {
	if args == nil {
		args = []json.RawMessage{}
	}
	return s.router.Invoke(context.Background(), channel, args)
}
