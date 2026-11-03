package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// releaseServer serves a GitHub/Gitee-shaped release payload at
// /repos/<owner>/<repo>/releases/latest.
func releaseServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/"+repository+"/releases/latest" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server
}

// check runs one provider check against base with platform/arch pinned, so the
// test does not depend on the host that runs it. It goes through newProvider,
// i.e. the same Gitee-compat HTTP client the production updater uses.
func check(t *testing.T, base, currentVersion string) (*updater.Release, error) {
	t.Helper()
	provider, err := newProvider(base)
	if err != nil {
		t.Fatalf("newProvider: %v", err)
	}
	rel, err := provider.Check(context.Background(), updater.CheckRequest{
		CurrentVersion: currentVersion,
		Platform:       "windows",
		Arch:           "amd64",
	})
	return rel, err
}

func TestCheckFindsNewerRelease(t *testing.T) {
	server := releaseServer(t, `{
		"tag_name":"v0.14.0",
		"name":"YiiOffice 0.14.0",
		"body":"Release notes",
		"assets":[{"name":"YiiOffice_0.14.0_windows_amd64_setup.exe","size":1024,"browser_download_url":"https://example.com/setup.exe"}]
	}`)

	rel, err := check(t, server.URL, "0.13.0")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if rel == nil {
		t.Fatal("expected a release, got nil")
	}
	if rel.Version != "0.14.0" {
		t.Errorf("version = %q, want 0.14.0", rel.Version)
	}
	if rel.Notes != "Release notes" {
		t.Errorf("notes = %q", rel.Notes)
	}
	if got, want := rel.Metadata["github.asset.url"], "https://example.com/setup.exe"; got != want {
		t.Errorf("asset url = %v, want %s", got, want)
	}
}

func TestCheckReportsUpToDate(t *testing.T) {
	server := releaseServer(t, `{"tag_name":"v0.12.0","body":"old","assets":[]}`)

	rel, err := check(t, server.URL, "0.13.0")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if rel != nil {
		t.Errorf("expected no release, got %+v", rel)
	}
}

func TestCheckSurfacesServerErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)

	if _, err := check(t, server.URL, "0.13.0"); err == nil {
		t.Fatal("expected an error for a 500 response")
	}
}

func TestCheckRejectsReleaseWithoutMatchingAsset(t *testing.T) {
	server := releaseServer(t, `{
		"tag_name":"v0.14.0",
		"assets":[{"name":"YiiOffice_0.14.0_linux_amd64.tar.gz","browser_download_url":"https://example.com/x"}]
	}`)

	if _, err := check(t, server.URL, "0.13.0"); err == nil {
		t.Fatal("expected an error when the release has no windows asset")
	}
}
