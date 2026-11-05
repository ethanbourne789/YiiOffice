package update

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// metaChecksumMissing marks a Release that has no checksum sidecar, so the
// shell can tell "publisher shipped none" from "verification will run".
const metaChecksumMissing = "update.checksum.missing"

// checksumProvider decorates the official GitHub provider with SHA-256
// sidecar discovery. The provider itself only publishes a checksum when
// Config.ChecksumAsset names a fixed asset; YiiOffice's sidecar carries the
// version in its filename (YiiOffice_<version>_setup.exe.sha256), so the
// lookup is done here against the asset list captured during Check.
//
// Everything after Check stays upstream: Download streams the artifact and
// the Updater hashes it in the same pass, then compares against
// Release.Verification.Digest and refuses to install on a mismatch
// (verify.go, runVerification). This type only supplies the expected digest.
type checksumProvider struct {
	*github.Provider

	client *http.Client
	// base is the release API URL this provider was configured with. Asset
	// URLs in the feed are untrusted input and are pinned to this host/scheme
	// (or to the official release hosts over https).
	base string

	// checkMu serialises Check so the captured asset list cannot be
	// overwritten by a second call before this one reads it.
	checkMu sync.Mutex
	assets  assetTable
}

// assetTable is the sink the AssetMatcher writes into. The matcher is the
// only exported hook through which the provider hands callers the asset
// list, and it runs before Check returns, so the slice is current when Check
// reads it back.
type assetTable struct {
	last []github.ReleaseAsset
}

func (t *assetTable) match(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	t.last = assets
	return matchInstallerAsset(req, assets)
}

// matchInstallerAsset prefers the upstream platform/arch heuristic and falls
// back to YiiOffice's own installer naming. Every asset published so far is
// "YiiOffice_<version>_setup.exe", which carries neither the platform nor the
// arch token, so DefaultAssetMatcher returns -1 and the official provider
// rejects the release with "release X has no asset for windows/amd64" — even
// though the file is the right one. The fallback only accepts the _setup.exe
// suffix, which no checksum sidecar (".sha256") or archive has.
func matchInstallerAsset(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	if i := github.DefaultAssetMatcher(req, assets); i >= 0 {
		return i
	}
	for i, a := range assets {
		if strings.HasSuffix(strings.ToLower(a.Name), "_setup.exe") {
			return i
		}
	}
	return -1
}

// assetURLAllowed reports whether an asset URL taken from the untrusted
// release feed may be fetched. Assets must stay on the same host and scheme
// as the configured release API (Gitee/GitHub feed and its downloads), or on
// an official release host over https. A tampered feed must not be able to
// point the checksum sidecar or the installer at an arbitrary host.
func (p *checksumProvider) assetURLAllowed(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil {
		return false
	}
	if base, berr := url.Parse(p.base); berr == nil &&
		strings.EqualFold(u.Host, base.Host) && u.Scheme == base.Scheme {
		return true
	}
	return u.Scheme == "https" && allowedReleaseHost(u.Hostname())
}

// Check resolves the release and attaches the publisher's SHA-256 digest when
// a sidecar is present.
//
// Failure policy: a sidecar that exists but cannot be fetched or parsed
// aborts the check — installing bytes whose published checksum we failed to
// read is exactly the case this guard is for. A release without any sidecar
// is still offered (see metaChecksumMissing): older releases predate checksum
// publication, and refusing them would strand every installation on those
// versions. The updater then has no digest to enforce and installs
// unverified, which is why the caller must surface that state before
// installing.
func (p *checksumProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	p.checkMu.Lock()
	defer p.checkMu.Unlock()

	p.assets.last = nil
	rel, err := p.Provider.Check(ctx, req)
	if err != nil || rel == nil {
		return rel, err
	}

	// The feed is untrusted: reject the whole release when any asset points
	// off-platform, before either the sidecar fetch or the upstream download.
	for _, a := range p.assets.last {
		if a.URL != "" && !p.assetURLAllowed(a.URL) {
			return nil, fmt.Errorf("release asset %q points to a host outside the release allowlist", a.Name)
		}
	}

	digest, err := p.checksum(ctx, rel.Artifact.Filename)
	if err != nil {
		return nil, err
	}
	if digest == nil {
		if rel.Metadata == nil {
			rel.Metadata = map[string]any{}
		}
		rel.Metadata[metaChecksumMissing] = true
		return rel, nil
	}
	rel.Verification = &updater.Verification{
		DigestAlgo: "sha256",
		Digest:     digest,
	}
	return rel, nil
}

// checksum returns the expected digest for target, or (nil, nil) when the
// release carries no sidecar.
func (p *checksumProvider) checksum(ctx context.Context, target string) ([]byte, error) {
	asset, err := findChecksumAsset(p.assets.last, target)
	if err != nil {
		return nil, err
	}
	if asset == nil {
		return nil, nil
	}
	if asset.URL == "" {
		return nil, fmt.Errorf("checksum sidecar %q has no download URL", asset.Name)
	}
	if !p.assetURLAllowed(asset.URL) {
		return nil, fmt.Errorf("checksum sidecar %q has a URL outside the release host allowlist", asset.Name)
	}
	body, err := fetchChecksum(ctx, p.client, asset.URL)
	if err != nil {
		return nil, fmt.Errorf("checksum sidecar %q: %w", asset.Name, err)
	}
	digest, err := parseChecksum(body, target)
	if err != nil {
		return nil, fmt.Errorf("checksum sidecar %q: %w", asset.Name, err)
	}
	return digest, nil
}
