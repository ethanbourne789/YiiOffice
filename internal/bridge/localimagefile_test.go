package bridge

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"gitee.com/ethanbourne789/yiioffice/internal/assets"
)

// The /md-asset route and ShellService.ReadLocalImage must answer the same
// question the same way; this drives the real policy through the HTTP route.
//
// Root escapes are covered at the policy level (TestValidateLocalPathRejects-
// OutsideRoots) rather than here, because the policy also admits the user
// profile and a temporary directory lives under it on Windows.
func TestLocalImageFileFeedsTheAssetRoute(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "note-assets", "photo.png")
	if err := os.MkdirAll(filepath.Dir(inside), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inside, []byte("\x89PNG\r\n\x1a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	notes := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(notes, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := assets.New(fstest.MapFS{}, assets.WithLocalFiles(LocalImageFile(func() []string {
		return []string{root}
	})))

	tests := []struct {
		name   string
		path   string
		status int
	}{
		{"image under a configured root", inside, http.StatusOK},
		{"non-image under a configured root", notes, http.StatusForbidden},
		{"missing file", filepath.Join(root, "gone.png"), http.StatusNotFound},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/md-asset?p="+url.QueryEscape(tc.path), nil))
			if rec.Code != tc.status {
				t.Fatalf("got %d (%q), want %d", rec.Code, rec.Body.String(), tc.status)
			}
		})
	}
}
