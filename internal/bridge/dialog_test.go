package bridge

import (
	"context"
	"encoding/json"
	"testing"
)

func TestRegisterDialogs_Browse(t *testing.T) {
	r := NewRouter()
	called := false
	RegisterDialogs(r, func() ([]string, error) {
		called = true
		return []string{"/path/to/file.docx"}, nil
	}, func(string) error { return nil })

	if !r.Has(ChannelBrowse) {
		t.Fatal("ChannelBrowse not registered")
	}

	result, err := r.Invoke(context.Background(), ChannelBrowse, []json.RawMessage{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("openFileFunc not called")
	}

	paths, ok := result.([]string)
	if !ok {
		t.Fatalf("result is not []string: %T", result)
	}
	if len(paths) != 1 || paths[0] != "/path/to/file.docx" {
		t.Errorf("unexpected result: %v", result)
	}
}

func TestRegisterDialogs_Browse_Error(t *testing.T) {
	r := NewRouter()
	testErr := errorString("dialog cancelled")
	RegisterDialogs(r, func() ([]string, error) {
		return nil, testErr
	}, func(string) error { return nil })

	_, err := r.Invoke(context.Background(), ChannelBrowse, []json.RawMessage{})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestRegisterDialogs_RevealPath(t *testing.T) {
	r := NewRouter()
	var revealed string
	RegisterDialogs(r, func() ([]string, error) { return nil, nil }, func(p string) error {
		revealed = p
		return nil
	})

	if !r.Has(ChannelRevealPath) {
		t.Fatal("ChannelRevealPath not registered")
	}

	result, err := r.Invoke(context.Background(), ChannelRevealPath, []json.RawMessage{
		json.RawMessage(`"/path/to/file.docx"`),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result, got %v", result)
	}
	if revealed != "/path/to/file.docx" {
		t.Errorf("revealed = %q, want %q", revealed, "/path/to/file.docx")
	}
}

func TestRegisterDialogs_RevealPath_MissingArg(t *testing.T) {
	r := NewRouter()
	RegisterDialogs(r, func() ([]string, error) { return nil, nil }, func(string) error { return nil })

	_, err := r.Invoke(context.Background(), ChannelRevealPath, []json.RawMessage{})
	if err == nil {
		t.Fatal("expected error for missing arg, got nil")
	}
}

func TestRegisterDialogs_PickDefaultSaveDir(t *testing.T) {
	r := NewRouter()
	RegisterDialogs(r, func() ([]string, error) { return nil, nil }, func(string) error { return nil })

	if !r.Has(ChannelPickDefaultSaveDir) {
		t.Fatal("ChannelPickDefaultSaveDir not registered")
	}

	result, err := r.Invoke(context.Background(), ChannelPickDefaultSaveDir, []json.RawMessage{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result, got %v", result)
	}
}

type errorString string

func (e errorString) Error() string { return string(e) }
