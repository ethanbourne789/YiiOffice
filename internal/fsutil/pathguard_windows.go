//go:build windows

package fsutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Guard authorises file accesses against a fixed set of roots.
type Guard struct {
	roots []string
}

var reservedNames = map[string]struct{}{
	"CON": {}, "PRN": {}, "AUX": {}, "NUL": {},
	"COM1": {}, "COM2": {}, "COM3": {}, "COM4": {}, "COM5": {}, "COM6": {}, "COM7": {}, "COM8": {}, "COM9": {},
	"LPT1": {}, "LPT2": {}, "LPT3": {}, "LPT4": {}, "LPT5": {}, "LPT6": {}, "LPT7": {}, "LPT8": {}, "LPT9": {},
}

// NewGuard canonicalises roots once. Roots must exist.
func NewGuard(roots []string) (*Guard, error) {
	if len(roots) == 0 {
		return nil, errors.New("guard requires at least one root")
	}
	out := make([]string, 0, len(roots))
	for _, root := range roots {
		abs, err := filepath.Abs(root)
		if err != nil {
			return nil, fmt.Errorf("abs %s: %w", root, err)
		}
		resolved, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", root, err)
		}
		out = append(out, strings.ToLower(filepath.Clean(resolved)))
	}
	return &Guard{roots: out}, nil
}

// Authorize returns the canonical absolute path when it stays inside a root.
func (g *Guard) Authorize(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", errors.New("empty path")
	}
	if strings.ContainsRune(raw, 0) {
		return "", errors.New("path contains NUL")
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return "", fmt.Errorf("abs: %w", err)
	}
	if err := checkWindowsName(abs); err != nil {
		return "", err
	}
	canonical := abs
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		canonical = resolved
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("resolve: %w", err)
	}
	lower := strings.ToLower(filepath.Clean(canonical))
	for _, root := range g.roots {
		if lower == root || strings.HasPrefix(lower, root+string(filepath.Separator)) {
			return canonical, nil
		}
	}
	return "", fmt.Errorf("path outside authorised roots: %s", raw)
}

func checkWindowsName(abs string) error {
	rest := strings.TrimPrefix(abs, filepath.VolumeName(abs))
	if strings.ContainsRune(rest, ':') {
		return errors.New("alternate data stream not allowed")
	}
	base := filepath.Base(abs)
	stem := strings.ToUpper(strings.TrimSuffix(base, filepath.Ext(base)))
	if _, bad := reservedNames[stem]; bad {
		return fmt.Errorf("reserved device name: %s", base)
	}
	if strings.HasSuffix(base, " ") || strings.HasSuffix(base, ".") {
		return errors.New("trailing space or dot not allowed")
	}
	return nil
}
