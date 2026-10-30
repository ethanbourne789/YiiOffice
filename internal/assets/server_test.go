package assets

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testRoot() fstest.MapFS {
	return fstest.MapFS{
		"shell/index.html":       {Data: []byte("<html>shell</html>")},
		"docs/index.html":        {Data: []byte("<html>docs</html>")},
		"docs/assets/app.js":     {Data: []byte("console.log('docs')")},
		"sheets/index.html":      {Data: []byte("<html>sheets</html>")},
		"slides/index.html":      {Data: []byte("<html>slides</html>")},
		"pdf/index.html":         {Data: []byte("<html>pdf</html>")},
		"markdown/index.html":    {Data: []byte("<html>markdown</html>")},
		"shell/assets/main.css":  {Data: []byte("body{}")},
		"shell/assets/main.js":   {Data: []byte("console.log('shell')")},
	}
}

func do(t *testing.T, fsys fs.FS, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	New(fsys).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestRootServesShellIndex(t *testing.T) {
	rec := do(t, testRoot(), "/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "shell") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestAppPrefixServesItsIndex(t *testing.T) {
	rec := do(t, testRoot(), "/docs/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "docs") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestAppAssetServedWithContentType(t *testing.T) {
	rec := do(t, testRoot(), "/docs/assets/app.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestSPAFallbackToIndex(t *testing.T) {
	rec := do(t, testRoot(), "/docs/deep/link")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "docs") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestRejectsDotDotTraversal(t *testing.T) {
	rec := do(t, testRoot(), "/docs/../../go.mod")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("got %d", rec.Code)
	}
}

func TestSetsSecurityHeaders(t *testing.T) {
	rec := do(t, testRoot(), "/")
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Fatalf("csp = %q", csp)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
}

func TestUnknownAppReturns404(t *testing.T) {
	rec := do(t, testRoot(), "/nope/index.html")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d", rec.Code)
	}
}

// TestRootRelativeShellAssets verifies that the shell bundle served at "/" can
// load its "./assets/..." URLs, which arrive without the /shell/ prefix.
func TestRootRelativeShellAssets(t *testing.T) {
	rec := do(t, testRoot(), "/assets/main.css")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "body{}") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	rec = do(t, testRoot(), "/assets/main.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("js got %d", rec.Code)
	}
}

// TestEveryRendererBundleIsMounted guards the app list used by the shell's
// tab frames; a missing entry makes the whole editor tab 404.
func TestEveryRendererBundleIsMounted(t *testing.T) {
	for _, app := range []string{"docs", "sheets", "slides", "pdf", "markdown"} {
		rec := do(t, testRoot(), "/"+app+"/")
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), app) {
			t.Fatalf("%s: got %d %q", app, rec.Code, rec.Body.String())
		}
	}
}
