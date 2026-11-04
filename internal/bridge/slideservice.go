package bridge

import (
	"encoding/base64"
	"os"
	"path/filepath"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// SlidesService exposes the Slides editor real operations as an official
// Wails V3 named binding service. Slide editing (edit-text, add-element,
// undo, …) runs entirely inside the slides renderer against the local
// pptx-engine and needs no backend channel; only open/save/print/present
// require host services.
type SlidesService struct {
	rm *host.RecentManager
}

// NewSlidesService returns a SlidesService.
func NewSlidesService(rm *host.RecentManager) *SlidesService {
	return &SlidesService{rm: rm}
}

// OpenPath reads a file and returns its base64-encoded content. The path must
// be granted (a dialog pick or the Home open funnel) or resolve inside the
// authorised roots, so a crafted deck cannot name any file it likes.
func (s *SlidesService) OpenPath(path string) (string, error) {
	authorised, err := authoriseLocalFileRead(nil, recentDocumentDirs(s.rm), path)
	if err != nil {
		return "", codedError(ErrOpenPathNotAuthorised, err)
	}
	data, err := os.ReadFile(authorised)
	if err != nil {
		return "", codedError(ErrOpenReadFailed, err)
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
		return nil, codedError(ErrOpenDialogFailed, err)
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
	authorised, err := authoriseLocalFileRead(nil, recentDocumentDirs(s.rm), path)
	if err != nil {
		return PickedAttachment{Error: codedMessage(ErrOpenPathNotAuthorised, err.Error())}
	}
	data, err := os.ReadFile(authorised)
	if err != nil {
		return PickedAttachment{Error: codedMessage(ErrOpenReadFailed, err.Error())}
	}
	return PickedAttachment{
		OK:     true,
		Path:   authorised,
		Name:   filepath.Base(authorised),
		Mime:   imageMime(authorised),
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
