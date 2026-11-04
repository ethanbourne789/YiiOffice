package fsutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unicode"
	"unicode/utf8"
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

// PathKey returns the canonical comparison key for a filesystem path. The path
// is cleaned first, then case-folded on the platforms whose filesystems compare
// names case-insensitively (Windows and macOS).
//
// The fold replaces every rune with the smallest rune of its simple case-folding
// orbit — exactly the equivalence strings.EqualFold uses. It is a one-to-one
// rune replacement, so it never alters path structure: separators, rune count,
// the "\\server\share" UNC prefix and the "\\?\" extended-length prefix all
// survive. A plain strings.ToLower would not do: it maps U+0130 'İ' onto 'i',
// collapsing two names Windows keeps distinct, and it changes byte lengths.
// Undecodable bytes are copied verbatim so two distinct byte sequences can
// never end up with the same key.
//
// Callers compare keys, never raw paths.
func PathKey(path string) string {
	clean := filepath.Clean(path)
	if !caseInsensitivePath {
		return clean
	}
	return foldCase(clean)
}

func foldCase(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b.WriteByte(s[i])
			i++
			continue
		}
		b.WriteRune(foldRune(r))
		i += size
	}
	return b.String()
}

func foldRune(r rune) rune {
	// unicode.SimpleFold walks a case orbit (it returns r itself when the rune
	// has no case variants); the smallest member is a stable representative.
	min := r
	for f := unicode.SimpleFold(r); f != r; f = unicode.SimpleFold(f) {
		if f < min {
			min = f
		}
	}
	return min
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
		resolved, err := canonicalize(abs)
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", root, err)
		}
		out = append(out, PathKey(resolved))
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
	key := PathKey(canonical)
	for _, root := range g.roots {
		// Both sides are fold-keys produced by PathKey, so the separator after
		// the root still marks the boundary exactly.
		if key == root || strings.HasPrefix(key, root+string(filepath.Separator)) {
			return canonical, nil
		}
	}
	return "", fmt.Errorf("path outside authorised roots: %s", raw)
}

// ResolveExistingPrefix resolves symlinks and junctions as far as the path
// exists, re-joining the missing remainder. Callers that must authorise a
// path before touching it (the bridge's destructive file operations) use it so
// a link planted inside an allowed folder cannot redirect the check elsewhere.
func ResolveExistingPrefix(path string) (string, error) {
	return resolveExistingPrefix(path)
}

// resolveExistingPrefix canonicalises path as far as the filesystem allows:
// the longest existing prefix is fully resolved (symlinks, Windows junctions,
// and on Windows 8.3 short names), then the non-existent remainder — e.g. a
// save-as target whose file is not yet written — is re-joined verbatim.
//
// Authorize needs this because roots are canonicalised the same way; comparing
// an unresolved short-form path against them would falsely reject legitimate
// paths (GitHub's Windows runners expose TEMP in short form). It also closes a
// link escape: without this, a non-existent path under a symlinked (or
// junctioned) directory inside a root would be allowed and the caller would
// then follow the link out of the root.
func resolveExistingPrefix(path string) (string, error) {
	if resolved, err := canonicalize(path); err == nil {
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
		resolved, err := canonicalize(cur)
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

// maxReparsePoints bounds how many junctions/symlinks a single path may
// traverse, matching the limit filepath.EvalSymlinks applies to symlinks.
const maxReparsePoints = 255

// canonicalize resolves every redirect in path: junctions first, then
// symlinks and Windows short names via filepath.EvalSymlinks.
//
// filepath.EvalSymlinks only follows entries Windows reports as symlinks; a
// directory junction is reported as an irregular reparse point, so it is
// either left in place or — when further components follow — rejected as
// ENOTDIR. Either way a junction planted inside an authorised root could
// redirect an access outside it, so it has to be resolved explicitly.
func canonicalize(path string) (string, error) {
	for i := 0; i <= maxReparsePoints; i++ {
		next, found, err := resolveFirstJunction(path)
		if err != nil {
			return "", err
		}
		if found {
			path = next
			continue
		}
		return filepath.EvalSymlinks(path)
	}
	return "", errors.New("too many reparse points in path")
}

// resolveFirstJunction replaces the first Windows junction in path with its
// target, re-joining the remainder. It reports whether a junction was found.
// A path with no junction (including every path off Windows) comes back
// unchanged and un-walked beyond the stat calls needed to tell.
func resolveFirstJunction(path string) (string, bool, error) {
	if runtime.GOOS != "windows" {
		return path, false, nil
	}
	vol := filepath.VolumeName(path)
	end := len(vol)
	if end < len(path) && os.IsPathSeparator(path[end]) {
		end++
	}
	cur, rest := path[:end], path[end:]
	for rest != "" {
		var comp string
		if i := strings.IndexByte(rest, filepath.Separator); i >= 0 {
			comp, rest = rest[:i], rest[i+1:]
		} else {
			comp, rest = rest, ""
		}
		candidate := filepath.Join(cur, comp)
		cur = candidate
		info, err := os.Lstat(candidate)
		if err != nil || info.Mode()&os.ModeIrregular == 0 {
			// Missing component or an ordinary entry.
			continue
		}
		target, err := os.Readlink(candidate)
		if err != nil {
			// A reparse point of another kind (e.g. a cloud placeholder); it
			// does not redirect the path, so leave it alone.
			continue
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(candidate), target)
		}
		if rest != "" {
			target = filepath.Join(target, rest)
		}
		return filepath.Clean(target), true, nil
	}
	return path, false, nil
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
