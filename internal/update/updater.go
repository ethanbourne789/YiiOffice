// Package update provides auto-update functionality with version checking, download, and silent install.
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// UpdateInfo describes an available update.
type UpdateInfo struct {
	Version     string `json:"version"`
	DownloadURL string `json:"downloadUrl"`
	Notes       string `json:"notes,omitempty"`
}

// Updater handles checking for and downloading updates.
type Updater struct {
	httpClient *http.Client
	releaseURL string
	currentVer string
}

// New creates a new Updater.
func New(currentVersion string, releaseURL string) *Updater {
	return &Updater{
		httpClient: &http.Client{},
		releaseURL: releaseURL,
		currentVer: currentVersion,
	}
}

// CheckForUpdates queries the release server for a newer version.
// Returns nil if no update is available.
func (u *Updater) CheckForUpdates(ctx context.Context) (*UpdateInfo, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", u.releaseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch release info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("release server returned status %d", resp.StatusCode)
	}

	var release giteeRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("failed to decode release: %w", err)
	}

	// Compare versions
	if compareVersions(release.TagName, u.currentVer) <= 0 {
		return nil, nil // no update
	}

	// Find the Windows installer asset
	var downloadURL string
	for _, asset := range release.Assets {
		if strings.HasSuffix(strings.ToLower(asset.BrowserDownloadURL), ".exe") {
			downloadURL = asset.BrowserDownloadURL
			break
		}
	}
	if downloadURL == "" {
		return nil, errors.New("no Windows installer found in release")
	}

	return &UpdateInfo{
		Version:     release.TagName,
		DownloadURL: downloadURL,
		Notes:       release.Body,
	}, nil
}

// DownloadAndInstall downloads the update installer and runs it silently.
// This function should be called in a goroutine.
func (u *Updater) DownloadAndInstall(ctx context.Context, updateURL string) error {
	tempDir := filepath.Join(os.TempDir(), "yiioffice_update")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}

	installerPath := filepath.Join(tempDir, "YiiOffice_setup.exe")

	req, err := http.NewRequestWithContext(ctx, "GET", updateURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create download request: %w", err)
	}

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download update: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	f, err := os.Create(installerPath)
	if err != nil {
		return fmt.Errorf("failed to create installer file: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		return fmt.Errorf("failed to write installer: %w", err)
	}
	f.Close()

	appPath, _ := os.Executable()
	parentDir := filepath.Dir(appPath)

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command(installerPath, "/S", "/D="+parentDir, "/RESTARTCMD="+appPath)
	} else {
		return errors.New("auto-update is only supported on Windows")
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start installer: %w", err)
	}

	os.Exit(0)
	return nil
}

// compareVersions compares two version strings (e.g. "0.14.0" vs "0.13.0").
// Returns 1 if a > b, -1 if a < b, 0 if equal.
func compareVersions(a, b string) int {
	a = strings.TrimPrefix(strings.TrimSpace(a), "v")
	b = strings.TrimPrefix(strings.TrimSpace(b), "v")

	partsA := strings.Split(a, ".")
	partsB := strings.Split(b, ".")

	max := len(partsA)
	if len(partsB) > max {
		max = len(partsB)
	}

	for i := 0; i < max; i++ {
		var va, vb int
		if i < len(partsA) {
			va, _ = strconv.Atoi(partsA[i])
		}
		if i < len(partsB) {
			vb, _ = strconv.Atoi(partsB[i])
		}
		if va > vb {
			return 1
		}
		if va < vb {
			return -1
		}
	}
	return 0
}

// giteeRelease represents a Gitee/GitHub release JSON response.
type giteeRelease struct {
	TagName string         `json:"tag_name"`
	Body    string         `json:"body"`
	Assets  []releaseAsset `json:"assets"`
}

type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}
