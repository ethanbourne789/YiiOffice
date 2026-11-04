package update

import (
	"context"
	"crypto/sha256"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// stubHost satisfies updater.Host; the check/download flow only uses Emit.
type stubHost struct{}

func (stubHost) Emit(string, ...any) bool { return true }
func (stubHost) OnEvent(string, func(any)) func() {
	return func() {}
}
func (stubHost) OpenWindow(updater.WindowOptions) updater.WindowHandle { return nil }
func (stubHost) Quit()                                                 {}

// staticProvider serves fixed bytes and declares the digest the updater must
// find in them. Verification is entirely upstream (updater/download.go +
// verify.go); this test proves the guard actually runs and fails closed.
type staticProvider struct {
	payload []byte
	digest  []byte
}

func (staticProvider) Name() string { return "static" }

func (p staticProvider) Check(context.Context, updater.CheckRequest) (*updater.Release, error) {
	return &updater.Release{
		Version:      "9.9.9",
		Artifact:     updater.Artifact{Filename: "YiiOffice_9.9.9_setup.exe"},
		Verification: &updater.Verification{DigestAlgo: "sha256", Digest: p.digest},
	}, nil
}

func (p staticProvider) Download(_ context.Context, _ *updater.Release, dst io.Writer, onProgress func(int64, int64)) error {
	if _, err := dst.Write(p.payload); err != nil {
		return err
	}
	onProgress(int64(len(p.payload)), int64(len(p.payload)))
	return nil
}

func stagingDirs(t *testing.T) []string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(exe))
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	var dirs []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "wails-update-") {
			dirs = append(dirs, filepath.Join(filepath.Dir(exe), e.Name()))
		}
	}
	return dirs
}

func runInstall(t *testing.T, provider staticProvider) (*updater.Updater, error) {
	t.Helper()
	u := updater.New(stubHost{})
	if err := u.Init(updater.Config{
		CurrentVersion: "1.0.0",
		Providers:      []updater.Provider{provider},
	}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if _, err := u.Check(context.Background()); err != nil {
		t.Fatalf("Check: %v", err)
	}
	return u, u.DownloadAndInstall(context.Background())
}

func TestDownloadAndInstallAcceptsMatchingDigest(t *testing.T) {
	payload := []byte("installer-bytes")
	sum := sha256.Sum256(payload)

	before := stagingDirs(t)
	u, err := runInstall(t, staticProvider{payload: payload, digest: sum[:]})
	if err != nil {
		t.Fatalf("expected the matching digest to install, got %v", err)
	}
	if u.State() != updater.StateReady {
		t.Errorf("state = %q, want ready", u.State())
	}
	staged := u.DownloadedPath()
	if staged == "" {
		t.Fatal("no staged path after a successful install")
	}
	t.Cleanup(func() { _ = os.RemoveAll(filepath.Dir(staged)) })
	if info, err := os.Stat(staged); err != nil || info.Size() != int64(len(payload)) {
		t.Fatalf("staged file unusable: %v", err)
	}
	if dirs := stagingDirs(t); len(dirs) != len(before)+1 {
		t.Fatalf("staging dirs = %v, want one more than %v", dirs, before)
	}
}

func TestDownloadAndInstallRejectsMismatchedDigest(t *testing.T) {
	payload := []byte("installer-bytes")
	wrong := sha256.Sum256([]byte("tampered-payload"))

	before := stagingDirs(t)
	u, err := runInstall(t, staticProvider{payload: payload, digest: wrong[:]})
	if err == nil {
		t.Fatal("expected a digest mismatch to abort the install")
	}
	if !strings.Contains(err.Error(), "digest mismatch") {
		t.Errorf("error = %v, want a digest mismatch", err)
	}
	if u.State() != updater.StateError {
		t.Errorf("state = %q, want error", u.State())
	}
	if staged := u.DownloadedPath(); staged != "" {
		t.Fatalf("mismatched payload should not be staged, got %q", staged)
	}
	if dirs := stagingDirs(t); len(dirs) != len(before) {
		t.Fatalf("mismatched payload left staging dirs behind: %v", dirs)
	}
}
