package bridge

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// SlidesService exposes the Slides editor real operations as an official
// Wails V3 named binding service. Editing operations (edit-text, add-element,
// undo, etc.) are all frontend stubs and remain on the legacy Router.
type SlidesService struct {
	rm *host.RecentManager
}

// NewSlidesService returns a SlidesService.
func NewSlidesService(rm *host.RecentManager) *SlidesService {
	return &SlidesService{rm: rm}
}

// OpenPath reads a file and returns its base64-encoded content.
func (s *SlidesService) OpenPath(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// Save atomically writes base64-decoded content to the given path.
func (s *SlidesService) Save(path string, content string) error {
	return slidesFileSave(path, content, s.rm)
}

// SaveAs atomically writes base64-decoded content to a new path and returns it.
func (s *SlidesService) SaveAs(path string, content string) (string, error) {
	if err := slidesFileSave(path, content, s.rm); err != nil {
		return "", err
	}
	return path, nil
}

// FilesRead reads a file and returns its base64-encoded content.
func (s *SlidesService) FilesRead(path string) (string, error) {
	return s.OpenPath(path)
}

// FilesReadImage reads an image file and returns its base64-encoded content.
func (s *SlidesService) FilesReadImage(path string) (string, error) {
	return s.OpenPath(path)
}

// PickFiles opens a native multi-select dialog filtered by media kind and
// returns the chosen paths. A canceled dialog yields an empty slice.
func (s *SlidesService) PickFiles(kind string) ([]string, error) {
	files, err := pickFilesByKind("Insert Media", kind)
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = []string{}
	}
	return files, nil
}

// PickedAttachment describes a media file added to a deck.
type PickedAttachment struct {
	OK     bool   `json:"ok"`
	Path   string `json:"path"`
	Name   string `json:"name"`
	Mime   string `json:"mime"`
	Base64 string `json:"base64"`
	Error  string `json:"error,omitempty"`
}

// FilesAdd validates a picked/dropped media path and returns its bytes
// base64-encoded, so the renderer can embed it without a second read.
func (s *SlidesService) FilesAdd(path string) PickedAttachment {
	data, err := os.ReadFile(path)
	if err != nil {
		return PickedAttachment{Error: fmt.Sprintf("read media: %v", err)}
	}
	return PickedAttachment{
		OK:     true,
		Path:   path,
		Name:   filepath.Base(path),
		Mime:   imageMime(path),
		Base64: base64.StdEncoding.EncodeToString(data),
	}
}

// Opened records the file in the recent list.
func (s *SlidesService) Opened(path string) {
	if s.rm != nil {
		s.rm.AddRecent(path)
	}
}

// Renamed emits the file-renamed event.
func (s *SlidesService) Renamed(path string, title string) {
	platform.Emit("home:file-renamed", map[string]any{
		"path":  path,
		"title": title,
	})
}

func slidesFileSave(path, content string, rm *host.RecentManager) error {
	return atomicBase64Save(path, content, func() {
		if rm != nil {
			rm.AddRecent(path)
		}
	})
}