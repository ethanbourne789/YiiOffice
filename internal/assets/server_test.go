package assets

import (
	"io/fs"
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testRoot() fstest.MapFS {
	return fstest.MapFS{
		"shell/index.html":                     {Data: []byte("<html>shell</html>")},
		"docs/index.html":                      {Data: []byte("<html>docs</html>")},
		"docs/assets/app.js":                   {Data: []byte("console.log('docs')")},
		"sheets/index.html":                    {Data: []byte("<html>sheets</html>")},
		"slides/index.html":                    {Data: []byte("<html>slides</html>")},
		"pdf/index.html":                       {Data: []byte("<html>pdf</html>")},
		"markdown/index.html":                  {Data: []byte("<html>markdown</html>")},
		"shell/assets/main.css":                {Data: []byte("body{}")},
		"shell/assets/main.js":                 {Data: []byte("console.log('shell')")},
		"pdf/assets/pdf.worker.min-abc123.mjs": {Data: []byte("onmessage=()=>{}")},
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

// TestMJSResistsPoisonedRegistry guards the CI failure where the Windows
// runner's HKCR entry made the mime table answer ".mjs" → "text/plain": the
// pdf.js worker was refused as a module script and every PDF failed to open.
// Poisoning the table here is exactly what that registry does at init time;
// pinModuleScriptMIME must undo it, and the test leaves the table pinned.
func TestMJSResistsPoisonedRegistry(t *testing.T) {
	if err := mime.AddExtensionType(".mjs", "text/plain"); err != nil {
		t.Fatalf("poison: %v", err)
	}
	pinModuleScriptMIME()

	rec := do(t, testRoot(), "/pdf/assets/pdf.worker.min-abc123.mjs")
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Fatalf("content-type = %q, want javascript", ct)
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

// TestCSPDoesNotNarrowRendererPolicies guards the regression that made every
// opened document blank: the response header is intersected with each app's
// <meta> policy, so a header without `blob:` in connect-src blocked the docs
// editor's fetch() of the blob URL carrying the file bytes.
func TestCSPDoesNotNarrowRendererPolicies(t *testing.T) {
	rec := do(t, testRoot(), "/docs/index.html")
	csp := rec.Header().Get("Content-Security-Policy")
	for _, want := range []string{
		"connect-src 'self' data: blob:",
		"media-src 'self' data: blob:",
		"img-src 'self' data: blob:",
		"frame-src 'self'",
	} {
		if !strings.Contains(csp, want) {
			t.Errorf("csp missing %q: %s", want, csp)
		}
	}
	// The bridge still has to run: no 'unsafe-inline' scripts, no wildcard hosts.
	for _, banned := range []string{"script-src 'self' 'unsafe-inline'", "connect-src *", "default-src *"} {
		if strings.Contains(csp, banned) {
			t.Errorf("csp must not contain %q: %s", banned, csp)
		}
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
