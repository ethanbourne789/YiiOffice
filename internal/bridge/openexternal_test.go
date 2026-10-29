package bridge

import (
	"context"
	"encoding/json"
	"testing"
)

func TestValidateExternalURL(t *testing.T) {
	cases := []struct {
		url  string
		ok   bool
	}{
		{"https://example.com/doc", true},
		{"http://example.com", true},
		{"javascript:alert(1)", false},
		{"file:///C:/Windows/System32", false},
		{"https://user:pass@example.com", false},
		{"", false},
		{"https://example.com/" + string(make([]byte, 3000)), false},
	}
	for _, tc := range cases {
		err := ValidateExternalURL(tc.url)
		if tc.ok && err != nil {
			t.Fatalf("%q: unexpected error %v", tc.url, err)
		}
		if !tc.ok && err == nil {
			t.Fatalf("%q: expected rejection", tc.url)
		}
	}
}

func TestOpenExternalRejectsUnsafeScheme(t *testing.T) {
	r := NewRouter()
	RegisterOpenExternal(r, func(string) error { return nil })
	_, err := r.Invoke(context.Background(), ChannelOpenExternal, []json.RawMessage{json.RawMessage(`"javascript:alert(1)"`)})
	if err == nil {
		t.Fatal("expected rejection")
	}
}

func TestOpenExternalInvokesOpener(t *testing.T) {
	var opened string
	r := NewRouter()
	RegisterOpenExternal(r, func(u string) error { opened = u; return nil })
	if _, err := r.Invoke(context.Background(), ChannelOpenExternal, []json.RawMessage{json.RawMessage(`"https://example.com"`)}); err != nil {
		t.Fatal(err)
	}
	if opened != "https://example.com" {
		t.Fatalf("got %q", opened)
	}
}
