package bridge

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
)

// ShellService exposes OS-level shell helpers to every renderer as an official
// Wails V3 named binding service. These channels are shared across all editors,
// so they are registered exactly once here (never per-editor).
type ShellService struct {
	opener func(string) error
	// roots resolves the folder roots the app exposes to the user. It is a
	// function rather than a slice because the sidebar list is edited at
	// runtime (add/remove folder) and a local read must follow it.
	roots func() []string
}

// NewShellService returns a ShellService bound to the given URL opener and to
// the provider of the roots a local file read may come from.
func NewShellService(opener func(string) error, roots func() []string) *ShellService {
	return &ShellService{opener: opener, roots: roots}
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
	// Same authoriser the /md-asset route uses, so the binding and the HTTP
	// route cannot disagree about which files are readable.
	safe, err := LocalImageFile(s.roots)(path)
	if err != nil {
		return "", fmt.Errorf("validate path: %w", err)
	}
	// Size before reading: the previous order loaded the whole file and then
	// rejected it, so the limit did not actually protect memory.
	info, err := os.Stat(safe)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	if info.Size() > maxLocalImageSize {
		return "", fmt.Errorf("file too large: %d bytes (limit %d)", info.Size(), maxLocalImageSize)
	}
	data, err := os.ReadFile(safe)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
}
