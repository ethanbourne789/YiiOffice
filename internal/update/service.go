// Package update wires the official Wails v3 updater to YiiOffice's release feed.
package update

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const (
	// Gitee mirrors the GitHub releases REST shape, so the GitHub provider
	// works against Gitee's API v5 once the base URL is swapped.
	giteeAPIBase = "https://gitee.com/api/v5"
	repository   = "ethanbourne789/yiioffice"
)

// Status is the outcome of a manual update check.
type Status struct {
	CurrentVersion string `json:"currentVersion"`
	Available      bool   `json:"available"`
	Version        string `json:"version,omitempty"`
	Notes          string `json:"notes,omitempty"`
}

// Service exposes the updater lifecycle to the shell.
type Service struct {
	updater *updater.Updater
}

// New configures the application-wide updater with the Gitee release feed.
// It must be called after application.New (which allocates app.Updater).
func New(app *application.App, currentVersion string) (*Service, error) {
	provider, err := github.New(github.Config{
		Repository: repository,
		BaseURL:    giteeAPIBase,
	})
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
	return &Service{updater: app.Updater}, nil
}

// CheckForUpdate asks the release feed whether a newer build exists. It never
// starts a download; callers decide after showing the notes.
func (s *Service) CheckForUpdate() (*Status, error) {
	status := &Status{CurrentVersion: s.updater.CurrentVersion()}
	rel, err := s.updater.Check(context.Background())
	if err != nil {
		return nil, err
	}
	if rel == nil {
		return status, nil
	}
	status.Available = true
	status.Version = rel.Version
	status.Notes = rel.Notes
	return status, nil
}

// DownloadAndInstall fetches the release found by the last CheckForUpdate and
// stages it for the restart. Progress arrives on the updater's own events.
func (s *Service) DownloadAndInstall() error {
	return s.updater.DownloadAndInstall(context.Background())
}

// RestartApp swaps the staged update in and relaunches the application.
func (s *Service) RestartApp() error {
	return s.updater.Restart(context.Background())
}
