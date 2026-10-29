package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		a, b     string
		expected int
	}{
		{"0.14.0", "0.13.0", 1},
		{"0.13.0", "0.14.0", -1},
		{"0.13.0", "0.13.0", 0},
		{"v0.13.0", "0.13.0", 0},
		{"1.0.0", "0.13.0", 1},
		{"0.1.1", "0.1.0", 1},
		{"0.1.0", "0.1.1", -1},
	}

	for _, tc := range tests {
		got := compareVersions(tc.a, tc.b)
		if got != tc.expected {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.expected)
		}
	}
}

func TestCheckForUpdates_NoUpdate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"tag_name":"0.12.0","body":"release notes","assets":[]}`))
	}))
	defer server.Close()

	u := New("0.13.0", server.URL)
	info, err := u.CheckForUpdates(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info != nil {
		t.Error("expected no update, got update info")
	}
}

func TestCheckForUpdates_UpdateAvailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"tag_name":"0.14.0",
			"body":"New release",
			"assets":[{"name":"YiiOffice_0.14.0_setup.exe","browser_download_url":"https://example.com/setup.exe"}]
		}`))
	}))
	defer server.Close()

	u := New("0.13.0", server.URL)
	info, err := u.CheckForUpdates(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info == nil {
		t.Fatal("expected update info, got nil")
	}
	if info.Version != "0.14.0" {
		t.Errorf("expected version 0.14.0, got %s", info.Version)
	}
	if info.DownloadURL != "https://example.com/setup.exe" {
		t.Errorf("unexpected download URL: %s", info.DownloadURL)
	}
}

func TestCheckForUpdates_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	u := New("0.13.0", server.URL)
	_, err := u.CheckForUpdates(context.Background())
	if err == nil {
		t.Error("expected error for 404 response")
	}
}
