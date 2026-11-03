package fsutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Guard authorises file accesses against a fixed set of roots.
//
// It is the single place that decides whether a path handed in by a renderer
// may be touched: the path is made absolute, Windows device-name and
// alternate-stream tricks are rejected, symlinks are resolved, and the result
// has to stay inside one of the configured roots. Callers get the canonical
// path back so the file they open is the file that was checked.
type Guard struct {
	roots []string
}

// caseInsensitivePath matches how the Windows and macOS filesystems compare
// names. Linux is case-sensitive, so a "Root/x" prefix must not match "root/x".
var caseInsensitivePath = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

var reservedNames = map[string]struct{}{
	"CON": {}, "PRN": {}, "AUX": {}, "NUL": {},
	"COM1": {}, "COM2": {}, "COM3": {}, "COM4": {}, "COM5": {}, "COM6": {}, "COM7": {}, "COM8": {}, "COM9": {},
	"LPT1": {}, "LPT2": {}, "LPT3": {}, "LPT4": {}, "LPT5": {}, "LPT6": {}, "LPT7": {}, "LPT8": {}, "LPT9": {},
}

// canonicalKey normalises a cleaned absolute path for prefix comparison.
func canonicalKey(path string) string {
	if caseInsensitivePath {
		return strings.ToLower(path)
	}
	return path
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
		out = append(out, canonicalKey(filepath.Clean(resolved)))
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
	if runtime.GOOS == "windows" {
		if err := checkWindowsName(abs); err != nil {
			return "", err
		}
	}
	canonical, err := resolveExistingPrefix(abs)
	if err != nil {
		return "", fmt.Errorf("resolve: %w", err)
	}
	key := canonicalKey(filepath.Clean(canonical))
	for _, root := range g.roots {
		if key == root || strings.HasPrefix(key, root+string(filepath.Separator)) {
			return canonical, nil
		}
	}
	return "", fmt.Errorf("path outside authorised roots: %s", raw)
}

// resolveExistingPrefix canonicalises path as far as the filesystem allows:
// the longest existing prefix is symlink-resolved (and, on Windows, expanded
// from 8.3 short form to long form), then the non-existent remainder — e.g. a
// save-as target whose file is not yet written — is re-joined verbatim.
//
// Authorize needs this because roots are canonicalised through EvalSymlinks,
// which always yields the long form; comparing an unresolved short-form path
// against them would falsely reject legitimate paths (GitHub's Windows runners
// expose TEMP in short form). It also closes a symlink escape: without this, a
// non-existent path under a symlinked directory inside a root would be allowed
// and the caller would then follow the symlink out of the root.
func resolveExistingPrefix(path string) (string, error) {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	var missing []string
	cur := path
	for {
		parent := filepath.Dir(cur)
		if parent == cur {
			// No existing component found (e.g. a path on a non-existent
			// volume); fall back to the cleaned absolute input.
			return filepath.Clean(path), nil
		}
		missing = append(missing, filepath.Base(cur))
		cur = parent
		resolved, err := filepath.EvalSymlinks(cur)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
	}
}

// checkWindowsName rejects names Win32 resolves to something other than the
// literal file: alternate data streams and the reserved device names.
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
