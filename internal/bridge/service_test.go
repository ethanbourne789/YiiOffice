package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestServiceInvokeDelegates(t *testing.T) {
	r := NewRouter()
	r.Handle("demo:ok", func(context.Context, []json.RawMessage) (any, error) { return 42, nil })

	s := NewService(r)
	got, err := s.Invoke("demo:ok", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 42 {
		t.Fatalf("got %v", got)
	}
}

func TestServiceInvokePropagatesUnknownChannel(t *testing.T) {
	s := NewService(NewRouter())
	_, err := s.Invoke("nope", nil)
	if !errors.Is(err, ErrUnknownChannel) {
		t.Fatalf("got %v", err)
	}
}
