package assets

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// escape encodes a filesystem path for the `p` query parameter.
func escape(path string) string { return url.QueryEscape(path) }

// localServer builds a server whose /md-asset route is backed by resolve.
func localServer(t *testing.T, resolve func(string) (string, error)) *Server {
	t.Helper()
	if resolve == nil {
		return New(testRoot())
	}
	return New(testRoot(), WithLocalFiles(resolve))
}

func pngFile(t *testing.T, dir, name string, size int64) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("\x89PNG\r\n\x1a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if size > 0 {
		if err := os.Truncate(path, size); err != nil {
			t.Fatal(err)
		}
	}
	return path
}

func get(t *testing.T, s *Server, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestLocalAssetServesAuthorisedImage(t *testing.T) {
	// Spaces, '+' and non-ASCII decode differently under every escaping rule;
	// the renderer sends encodeURIComponent, so the route has to survive it.
	path := pngFile(t, t.TempDir(), "my photo 1+1 图.png", 0)
	s := localServer(t, func(raw string) (string, error) { return raw, nil })

	rec := get(t, s, http.MethodGet, "/md-asset?p="+escape(path))
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "image/png") {
		t.Fatalf("content-type = %q", ct)
	}
	if rec.Body.Len() != 8 {
		t.Fatalf("body = %d bytes", rec.Body.Len())
	}
	// A cached picture would stay stale after the user edits it elsewhere.
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("cache-control = %q", cc)
	}
}

func TestLocalAssetHeadHasNoBody(t *testing.T) {
	path := pngFile(t, t.TempDir(), "photo.png", 0)
	s := localServer(t, func(raw string) (string, error) { return raw, nil })

	rec := get(t, s, http.MethodHead, "/md-asset?p="+escape(path))
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Fatalf("got %d with %d body bytes", rec.Code, rec.Body.Len())
	}
}

// The route must not leak whether a rejected path exists: one status covers
// "outside the roots", "not an image" and "does not exist on disk".
func TestLocalAssetRejectionIsOpaque(t *testing.T) {
	s := localServer(t, func(string) (string, error) { return "", errors.New("outside roots") })
	rec := get(t, s, http.MethodGet, "/md-asset?p="+escape("/etc/passwd"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("got %d", rec.Code)
	}
	if strings.Contains(strings.ToLower(rec.Body.String()), "root") {
		t.Fatalf("body leaks the reason: %q", rec.Body.String())
	}
}

func TestLocalAssetRequiresResolver(t *testing.T) {
	rec := get(t, localServer(t, nil), http.MethodGet, "/md-asset?p=/x.png")
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestLocalAssetRequiresPathParameter(t *testing.T) {
	s := localServer(t, func(raw string) (string, error) { return raw, nil })
	for _, target := range []string{"/md-asset", "/md-asset?p=", "/md-asset?p=%20"} {
		if rec := get(t, s, http.MethodGet, target); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d", target, rec.Code)
		}
	}
}

func TestLocalAssetMissingFileIs404(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "gone.png")
	s := localServer(t, func(raw string) (string, error) { return raw, nil })
	if rec := get(t, s, http.MethodGet, "/md-asset?p="+escape(missing)); rec.Code != http.StatusNotFound {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestLocalAssetRejectsDirectory(t *testing.T) {
	dir := t.TempDir()
	s := localServer(t, func(raw string) (string, error) { return raw, nil })
	if rec := get(t, s, http.MethodGet, "/md-asset?p="+escape(dir)); rec.Code != http.StatusNotFound {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestLocalAssetRejectsOversizeFile(t *testing.T) {
	path := pngFile(t, t.TempDir(), "huge.png", maxLocalAssetBytes+1)
	s := localServer(t, func(raw string) (string, error) { return raw, nil })
	if rec := get(t, s, http.MethodGet, "/md-asset?p="+escape(path)); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestLocalAssetRejectsNonGet(t *testing.T) {
	s := localServer(t, func(raw string) (string, error) { return raw, nil })
	if rec := get(t, s, http.MethodPost, "/md-asset?p=/x.png"); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("got %d", rec.Code)
	}
}
