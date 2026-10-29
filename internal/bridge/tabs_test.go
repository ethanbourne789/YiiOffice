package bridge

import (
	"context"
	"encoding/json"
	"testing"
)

func TestTabsListReturnsEmptyArray(t *testing.T) {
	r := NewRouter()
	RegisterTabs(r)
	got, err := r.Invoke(context.Background(), ChannelTabsList, nil)
	if err != nil {
		t.Fatal(err)
	}
	tabs, ok := got.([]any)
	if !ok || len(tabs) != 0 {
		t.Fatalf("got %#v", got)
	}
}

func TestTabsActivateRequiresId(t *testing.T) {
	r := NewRouter()
	RegisterTabs(r)
	if _, err := r.Invoke(context.Background(), ChannelTabsActivate, nil); err == nil {
		t.Fatal("expected error")
	}
	if _, err := r.Invoke(context.Background(), ChannelTabsActivate, []json.RawMessage{json.RawMessage(`"t1"`)}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
