// Package update wires the official Wails v3 updater to YiiOffice's release feed.
package update

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const (
	// Gitee mirrors the GitHub releases REST shape, so the GitHub provider
	// works against Gitee's API v5 once the base URL is swapped.
	giteeAPIBase = "https://gitee.com/api/v5"
	repository   = "ethanbourne789/yiioffice"

	// The HTTP client's 30s timeout only bounds individual requests; these
	// bound the whole check / download+verify+stage operation.
	updateCheckTimeout   = 45 * time.Second
	updateInstallTimeout = 10 * time.Minute
)

// Status is the outcome of a manual update check.
type Status struct {
	CurrentVersion string `json:"currentVersion"`
	Available      bool   `json:"available"`
	Version        string `json:"version,omitempty"`
	Notes          string `json:"notes,omitempty"`

	// Integrity is "sha256" when the release publishes a checksum sidecar
	// that DownloadAndInstall enforces before installing, or "missing" when
	// it does not. A missing sidecar does not block an update (older releases
	// predate them), but the caller should warn the user before confirming.
	Integrity string `json:"integrity,omitempty"`
}

const (
	// integritySHA256 means the install will be verified against a published
	// SHA-256 digest and refused on a mismatch.
	integritySHA256 = "sha256"
	// integrityMissing means the release has no sidecar: the install proceeds
	// unverified.
	integrityMissing = "missing"
)

// Service exposes the updater lifecycle to the shell.
type Service struct {
	updater *updater.Updater

	// The read-only check in latest.go needs none of the updater's state, so it
	// keeps its own copy of the feed base URL, the running version and the
	// Gitee-compatible HTTP client used to build the provider.
	base        string
	current     string
	checkClient *http.Client
}

// newProvider builds the GitHub-shaped release provider for base. The HTTP
// client carries the Gitee compatibility transport (see giteecompat.go): the
// v3.1.0 provider reads the asset "url" field, which Gitee omits in favour
// of browser_download_url. The provider also resolves the release's SHA-256
// sidecar so every downloadable release carries a digest to enforce.
func newProvider(base string) (*checksumProvider, error) {
	client := &http.Client{
		Timeout:   30 * time.Second,
		Transport: giteeCompatTransport{base: http.DefaultTransport},
	}
	p := &checksumProvider{client: client, base: base}
	inner, err := github.New(github.Config{
		Repository:   repository,
		BaseURL:      base,
		HTTPClient:   client,
		AssetMatcher: p.assets.match,
	})
	if err != nil {
		return nil, err
	}
	p.Provider = inner
	return p, nil
}

// New configures the application-wide updater with the Gitee release feed.
// It must be called after application.New (which allocates app.Updater).
func New(app *application.App, currentVersion string) (*Service, error) {
	provider, err := newProvider(giteeAPIBase)
	if err != nil {
		return nil, fmt.Errorf("update provider: %w", err)
	}
	if app == nil || app.Updater == nil {
		return nil, fmt.Errorf("updater unavailable before application creation")
	}
	if err := app.Updater.Init(updater.Config{
		CurrentVersion: currentVersion,
		Providers:      []updater.Provider{provider},
	}); err != nil {
		return nil, fmt.Errorf("configure updater: %w", err)
	}
	return &Service{
		updater:     app.Updater,
		base:        giteeAPIBase,
		current:     currentVersion,
		checkClient: provider.client,
	}, nil
}

// CheckForUpdate asks the release feed whether a newer build exists. It never
// starts a download; callers decide after showing the notes.
func (s *Service) CheckForUpdate() (*Status, error) {
	status := &Status{CurrentVersion: s.updater.CurrentVersion()}
	ctx, cancel := context.WithTimeout(context.Background(), updateCheckTimeout)
	defer cancel()
	rel, err := s.updater.Check(ctx)
	if err != nil {
		return nil, err
	}
	if rel == nil {
		return status, nil
	}
	status.Available = true
	status.Version = rel.Version
	status.Notes = rel.Notes
	if rel.Verification != nil && len(rel.Verification.Digest) > 0 {
		status.Integrity = integritySHA256
	} else {
		status.Integrity = integrityMissing
		platform.Logger().Warn("update release has no checksum sidecar",
			"version", rel.Version, "asset", rel.Artifact.Filename)
	}
	return status, nil
}

// DownloadAndInstall fetches the release found by the last CheckForUpdate,
// verifies it against the published SHA-256 digest, and stages it for the
// restart. A mismatch aborts the install and the staged bytes are discarded;
// progress arrives on the updater's own events.
func (s *Service) DownloadAndInstall() error {
	ctx, cancel := context.WithTimeout(context.Background(), updateInstallTimeout)
	defer cancel()
	if err := s.updater.DownloadAndInstall(ctx); err != nil {
		return fmt.Errorf("update aborted: %w", err)
	}
	return nil
}

// RestartApp swaps the staged update in and relaunches the application.
// Wails v3.1.0's Updater.Restart ignores its context argument entirely, so
// wrapping it in a deadline would only give a false sense of safety.
func (s *Service) RestartApp() error {
	return s.updater.Restart(context.Background())
}
