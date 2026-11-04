package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const (
	// checksumAssetSuffix is the sibling-asset suffix a release must publish
	// next to the installer. `task package:windows` writes it as
	// "YiiOffice_<version>_setup.exe.sha256"; a release that renames the
	// installer to include platform/arch should rename the sidecar with it.
	checksumAssetSuffix = ".sha256"

	// maxChecksumBytes bounds the sidecar body. A sha256sum listing for a
	// handful of assets is a few hundred bytes; anything near a megabyte is
	// not a checksum file.
	maxChecksumBytes = 1 << 20
)

// parseChecksum extracts the SHA-256 digest for target from a checksum
// sidecar. Two shapes are accepted:
//
//   - a bare digest, which is what `Get-FileHash | Set-Content` (the Taskfile
//     step) writes — 64 hex characters, any case, surrounding whitespace and
//     CR/LF ignored;
//   - a `sha256sum`-style listing, one entry per line as
//     "<hex>  <filename>" (the optional "*" binary marker and "./" prefix are
//     stripped). Empty lines and "#" comments are skipped.
//
// When the file holds several entries the filename picks the one for target.
// A single-entry file is used regardless of its filename: the digest still
// has to match the downloaded bytes, so a stale filename after a release
// rename cannot turn into a false accept — it either matches or is rejected.
//
// Anything malformed is an error rather than a skip: a sidecar that exists
// but cannot be read is a signal about the release, not an absent one.
func parseChecksum(body []byte, target string) ([]byte, error) {
	lines := strings.Split(string(body), "\n")
	type entry struct {
		digest []byte
		name   string
	}
	var entries []entry
	for i, raw := range lines {
		line := strings.TrimSpace(strings.TrimPrefix(raw, "\uFEFF"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		digest, err := decodeSHA256Hex(fields[0])
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", i+1, err)
		}
		name := ""
		if len(fields) > 1 {
			name = strings.TrimPrefix(fields[len(fields)-1], "*")
			name = filepath.Base(strings.TrimPrefix(name, "./"))
		}
		entries = append(entries, entry{digest: digest, name: name})
	}

	switch len(entries) {
	case 0:
		return nil, errors.New("no checksum entries")
	case 1:
		return entries[0].digest, nil
	}

	var matches [][]byte
	want := filepath.Base(target)
	for _, e := range entries {
		if e.name != "" && strings.EqualFold(e.name, want) {
			matches = append(matches, e.digest)
		}
	}
	switch len(matches) {
	case 0:
		return nil, fmt.Errorf("no entry for %q", want)
	case 1:
		return matches[0], nil
	default:
		return nil, fmt.Errorf("%d entries for %q", len(matches), want)
	}
}

// decodeSHA256Hex accepts a 64-character hexadecimal digest in either case.
func decodeSHA256Hex(token string) ([]byte, error) {
	if len(token) != sha256.Size*2 {
		return nil, fmt.Errorf("digest %q is not %d hexadecimal characters", token, sha256.Size*2)
	}
	digest, err := hex.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("digest %q is not hexadecimal: %w", token, err)
	}
	return digest, nil
}

// findChecksumAsset picks the sidecar for target out of the release's asset
// list. An exact "<target>.sha256" wins; otherwise a lone .sha256 asset is
// used (releases may upload the sidecar under its pre-rename name). More than
// one candidate without an exact match is ambiguous and rejected rather than
// guessed.
func findChecksumAsset(assets []github.ReleaseAsset, target string) (*github.ReleaseAsset, error) {
	var exact, all []github.ReleaseAsset
	for _, a := range assets {
		if !strings.HasSuffix(strings.ToLower(a.Name), checksumAssetSuffix) {
			continue
		}
		all = append(all, a)
		if strings.EqualFold(strings.TrimSuffix(a.Name, a.Name[len(a.Name)-len(checksumAssetSuffix):]), target) {
			exact = append(exact, a)
		}
	}
	switch {
	case len(exact) == 1:
		return &exact[0], nil
	case len(exact) > 1:
		return nil, fmt.Errorf("%d checksum assets match %q", len(exact), target)
	case len(all) == 0:
		return nil, nil
	case len(all) == 1:
		return &all[0], nil
	default:
		names := make([]string, len(all))
		for i, a := range all {
			names[i] = a.Name
		}
		return nil, fmt.Errorf("ambiguous checksum assets: %s", strings.Join(names, ", "))
	}
}

// fetchChecksum downloads a sidecar body. It reads at most maxChecksumBytes+1
// so a hostile or misconfigured URL cannot stream unbounded data into memory.
func fetchChecksum(ctx context.Context, client *http.Client, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/octet-stream")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxChecksumBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxChecksumBytes {
		return nil, fmt.Errorf("sidecar larger than %d bytes", maxChecksumBytes)
	}
	return body, nil
}
