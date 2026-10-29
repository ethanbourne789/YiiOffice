package bridge

import (
	"context"
	"encoding/json"
	"testing"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
)

func newTestRouter(t *testing.T) (*Router, *host.SettingsStore) {
	t.Helper()
	store, err := host.NewSettingsStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	r := NewRouter()
	RegisterHome(r, store, "1.2.3")
	return r, store
}

func call(t *testing.T, r *Router, channel string, args ...any) any {
	t.Helper()
	raw := make([]json.RawMessage, 0, len(args))
	for _, arg := range args {
		data, err := json.Marshal(arg)
		if err != nil {
			t.Fatal(err)
		}
		raw = append(raw, data)
	}
	got, err := r.Invoke(context.Background(), channel, raw)
	if err != nil {
		t.Fatalf("%s: %v", channel, err)
	}
	return got
}

func TestGetAppVersionReturnsInjectedVersion(t *testing.T) {
	r, _ := newTestRouter(t)
	if got := call(t, r, ChannelGetAppVersion); got != "1.2.3" {
		t.Fatalf("got %v", got)
	}
}

func TestThemeRoundTrip(t *testing.T) {
	r, store := newTestRouter(t)
	call(t, r, ChannelSetTheme, "dark")
	if got := call(t, r, ChannelGetTheme); got != "dark" {
		t.Fatalf("got %v", got)
	}
	if store.Snapshot().Theme != "dark" {
		t.Fatal("store not updated")
	}
}

func TestSetThemeRejectsInvalidValue(t *testing.T) {
	r, _ := newTestRouter(t)
	sepiaArg := json.RawMessage(`"sepia"`)
	if _, err := r.Invoke(context.Background(), ChannelSetTheme, []json.RawMessage{sepiaArg}); err == nil {
		t.Fatal("expected error")
	}
}

func TestLanguageRoundTrip(t *testing.T) {
	r, store := newTestRouter(t)
	call(t, r, ChannelSetLanguage, "en")
	if got := call(t, r, ChannelGetLanguage); got != "en" {
		t.Fatalf("got %v", got)
	}
	if store.Snapshot().Language != "en" {
		t.Fatal("store not updated")
	}
}
