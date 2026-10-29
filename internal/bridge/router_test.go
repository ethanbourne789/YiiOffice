package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestInvokeDispatchesRegisteredHandler(t *testing.T) {
	r := NewRouter()
	r.Handle("demo:echo", func(_ context.Context, args []json.RawMessage) (any, error) {
		v, err := DecodeArg[string](args, 0)
		if err != nil {
			return nil, err
		}
		return v + "!", nil
	})

	got, err := r.Invoke(context.Background(), "demo:echo", []json.RawMessage{json.RawMessage(`"hi"`)})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "hi!" {
		t.Fatalf("got %v", got)
	}
}

func TestInvokeUnknownChannel(t *testing.T) {
	r := NewRouter()
	_, err := r.Invoke(context.Background(), "missing", nil)
	if !errors.Is(err, ErrUnknownChannel) {
		t.Fatalf("got %v", err)
	}
}

func TestHandlePanicsOnDuplicateChannel(t *testing.T) {
	r := NewRouter()
	h := func(context.Context, []json.RawMessage) (any, error) { return nil, nil }
	r.Handle("dup", h)
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	r.Handle("dup", h)
}

func TestDecodeArgRejectsMissingIndex(t *testing.T) {
	if _, err := DecodeArg[string](nil, 0); err == nil {
		t.Fatal("expected error")
	}
}

func TestDecodeArgRejectsWrongType(t *testing.T) {
	_, err := DecodeArg[int]([]json.RawMessage{json.RawMessage(`"x"`)}, 0)
	if err == nil {
		t.Fatal("expected error")
	}
}
