package bridge

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// ShellService exposes OS-level shell helpers to every renderer as an official
// Wails V3 named binding service. These channels are shared across all editors,
// so they are registered exactly once here (never per-editor).
type ShellService struct {
	opener func(string) error
}

// NewShellService returns a ShellService bound to the given URL opener.
func NewShellService(opener func(string) error) *ShellService {
	return &ShellService{opener: opener}
}

// OpenExternal validates url and opens it in the system browser.
func (s *ShellService) OpenExternal(url string) error {
	if s.opener == nil {
		return errors.New("shell opener is not configured")
	}
	if err := ValidateExternalURL(url); err != nil {
		return err
	}
	return s.opener(url)
}

// ReadLocalImage reads a local image file and returns it as a base64 data string.
func (s *ShellService) ReadLocalImage(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// SetText writes text to the system clipboard. Returns true on success.
func (s *ShellService) SetText(text string) bool {
	return platform.ClipboardSetText(text)
}

// GetText returns the current clipboard text.
func (s *ShellService) GetText() (string, error) {
	text, ok := platform.ClipboardText()
	if !ok {
		return "", errors.New("clipboard read failed")
	}
	return text, nil
}