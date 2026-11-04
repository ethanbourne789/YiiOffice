package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/mod/semver"

	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

// Status slugs reported by LatestRelease. The shell maps each one to its own
// copy; they are part of the JSON contract, not UI text.
const (
	checkStatusLatest          = "latest"
	checkStatusUpdateAvailable = "update-available"
	checkStatusIncomparable    = "incomparable"
	checkStatusError           = "error"
)

const (
	// latestCheckTimeout bounds the whole read-only check. It is shorter than
	// the updater's own 30s client timeout on purpose: this runs from a settings
	// button and the user is waiting for an answer.
	latestCheckTimeout = 15 * time.Second

	// maxLatestBodyBytes caps the feed response. A release payload with long
	// notes is tens of kilobytes; a megabyte is already hostile.
	maxLatestBodyBytes = 1 << 20

	// maxErrorBodyBytes caps the upstream error text echoed into Message.
	maxErrorBodyBytes = 4096

	// maxErrorMessageRunes keeps a server error readable in a settings row.
	maxErrorMessageRunes = 200

	// maxNotesRunes bounds the release notes handed to the renderer. The full
	// notes stay on the release page, which the UI links to.
	maxNotesRunes = 2000
)

// LatestRelease is the outcome of a manual, read-only update check.
//
// Status is one of:
//
//   - "latest": the feed's newest release is not newer than CurrentVersion
//     (or the feed has no release at all);
//   - "update-available": the newest release is strictly newer;
//   - "incomparable": a release exists but its tag and/or the running version
//     is not a semantic version, so no ordering can be derived — the release
//     is reported as "a newer publication exists, ordering unknown";
//   - "error": the feed could not be read; Message carries the reason.
//
// LatestSemver is empty whenever the tag is not semver, which is exactly the
// condition that produces "incomparable".
type LatestRelease struct {
	Status         string `json:"status"`
	CurrentVersion string `json:"currentVersion"`

	// LatestVersion is the feed's raw release identifier (the tag name), kept
	// verbatim so a non-semver tag like "YiiOffice" still identifies the release.
	LatestVersion string `json:"latestVersion,omitempty"`
	// LatestSemver is the same version in normalized semver form ("0.14.0"),
	// or empty when the tag is not a semantic version.
	LatestSemver string `json:"latestSemver,omitempty"`
	// ReleaseName is the release's display title, when the feed provides one.
	ReleaseName string `json:"releaseName,omitempty"`

	// PublishedAt is the release timestamp in RFC3339/UTC. It is empty when the
	// feed provides none; PublishedAtSource says which field it came from
	// ("published_at" for GitHub, "created_at" for Gitee, which has no
	// published_at — verified against the live feed).
	PublishedAt       string `json:"publishedAt,omitempty"`
	PublishedAtSource string `json:"publishedAtSource,omitempty"`

	Notes          string `json:"notes,omitempty"`
	NotesTruncated bool   `json:"notesTruncated,omitempty"`

	// ReleaseURL is the human-facing release page. It is empty when the feed
	// offers no page URL we are willing to hand to the system browser.
	ReleaseURL string `json:"releaseUrl,omitempty"`

	// CheckedAt is when this answer was produced (RFC3339/UTC).
	CheckedAt string `json:"checkedAt"`

	// Message carries a stable error code plus diagnostics (the upstream reason
	// for "error", or the exact pair that could not be compared). The shell maps
	// the code to localized copy; the raw text is never shown as-is.
	Message string `json:"message,omitempty"`
}

// latestReleasePayload is the subset of the GitHub/Gitee release object this
// check reads. Timestamps stay strings: a zero time.Time cannot tell "absent"
// from "zero value", and Gitee genuinely omits published_at.
type latestReleasePayload struct {
	TagName     string               `json:"tag_name"`
	Name        string               `json:"name"`
	Body        string               `json:"body"`
	Prerelease  bool                 `json:"prerelease"`
	Draft       bool                 `json:"draft"`
	PublishedAt string               `json:"published_at"`
	CreatedAt   string               `json:"created_at"`
	HTMLURL     string               `json:"html_url"`
	Assets      []latestReleaseAsset `json:"assets"`
}

type latestReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	URL                string `json:"url"`
}

// CheckNow reads the newest release from the feed and reports whether it is
// newer than the running version. It is read-only: nothing is downloaded, no
// checksum is read, and the updater's install state is untouched.
//
// It deliberately does not delegate the decision to updater.Check. The official
// GitHub provider (wails v3.1.0 pkg/updater/providers/github/github.go:131-133)
// hard-codes golang.org/x/mod/semver between the fetch and the return, with no
// hook to replace or bypass it: a non-semver tag (today's Gitee release is
// tagged "YiiOffice") makes it return (nil, nil), which is indistinguishable
// from "up to date". It also rejects releases whose assets do not match
// windows/amd64 (github.go:135-139), and it enforces the checksum sidecar that
// this check must not read. Those three behaviours are exactly what a
// manual-mode check has to look past, so the release object is read directly
// and only the version comparison is reused — via the same x/mod/semver the
// upstream provider uses, so ordering semantics stay identical.
func (s *Service) CheckNow() *LatestRelease {
	out := &LatestRelease{
		CurrentVersion: s.current,
		CheckedAt:      time.Now().UTC().Format(time.RFC3339),
	}

	ctx, cancel := context.WithTimeout(context.Background(), latestCheckTimeout)
	defer cancel()

	rel, err := s.fetchLatestRelease(ctx)
	if err != nil {
		out.Status = checkStatusError
		out.Message = truncateRunes(err.Error(), maxErrorMessageRunes)
		platform.Logger().Warn("update check failed", "error", err)
		return out
	}
	if rel == nil {
		out.Status = checkStatusLatest
		return out
	}

	out.LatestVersion = strings.TrimSpace(rel.TagName)
	out.ReleaseName = strings.TrimSpace(rel.Name)
	out.Notes, out.NotesTruncated = truncateNotes(rel.Body)
	out.ReleaseURL = s.releasePageURL(rel)
	out.PublishedAt, out.PublishedAtSource = publishTimestamp(rel)

	latest := normalizeSemver(out.LatestVersion)
	current := normalizeSemver(s.current)
	out.LatestSemver = strings.TrimPrefix(latest, "v")

	switch {
	case out.LatestVersion == "":
		out.Status = checkStatusIncomparable
		out.Message = "update_feed_no_tag"
	case current == "" || latest == "":
		out.Status = checkStatusIncomparable
		out.Message = fmt.Sprintf("update_version_incomparable: cannot order %q against %q", out.LatestVersion, s.current)
	case semver.Compare(latest, current) > 0:
		out.Status = checkStatusUpdateAvailable
	default:
		out.Status = checkStatusLatest
	}
	return out
}

// fetchLatestRelease GETs the newest release. A nil payload with a nil error
// means the feed has no release published yet (HTTP 404), which the GitHub API
// documents as "no releases", not as a failure.
func (s *Service) fetchLatestRelease(ctx context.Context) (*latestReleasePayload, error) {
	endpoint := strings.TrimRight(s.base, "/") + "/repos/" + repository + "/releases/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.checkClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("update_feed_unreachable: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, nil
	default:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, fmt.Errorf("update_feed_http_error: HTTP %d: %s",
			resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var rel latestReleasePayload
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxLatestBodyBytes)).Decode(&rel); err != nil {
		return nil, fmt.Errorf("update_feed_invalid: %w", err)
	}
	return &rel, nil
}

// normalizeSemver returns the tag in the "v<x.y.z>" form x/mod/semver expects,
// or "" when it is not a semantic version. The upstream provider tolerates a
// leading "v"/"V" the same way (pkg/updater/internal/semver).
func normalizeSemver(tag string) string {
	t := strings.TrimSpace(tag)
	if t == "" {
		return ""
	}
	if strings.HasPrefix(t, "V") {
		t = "v" + t[1:]
	}
	if !strings.HasPrefix(t, "v") {
		t = "v" + t
	}
	if !semver.IsValid(t) {
		return ""
	}
	return t
}

// publishTimestamp reports the release timestamp and which feed field produced
// it. Gitee's API v5 release object has no published_at (verified live), so
// created_at is the fallback and the source is surfaced rather than silently
// substituted.
func publishTimestamp(rel *latestReleasePayload) (string, string) {
	if ts := normalizeTimestamp(rel.PublishedAt); ts != "" {
		return ts, "published_at"
	}
	if ts := normalizeTimestamp(rel.CreatedAt); ts != "" {
		return ts, "created_at"
	}
	return "", ""
}

// normalizeTimestamp re-emits a feed timestamp in RFC3339/UTC, or "" when it
// is absent or malformed — a junk value must not reach the renderer.
func normalizeTimestamp(raw string) string {
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// releasePageURL resolves the page the "open release" button points at.
//
// GitHub publishes html_url. Gitee's API v5 does not (verified live), so the
// page is rebuilt from an asset's download URL, which has the shape
// https://<host>/<owner>/<repo>/releases/download/<tag>/<asset>. Every candidate
// is host-allowlisted first: the feed is untrusted input and the shell hands
// whatever comes back to the system browser.
func (s *Service) releasePageURL(rel *latestReleasePayload) string {
	if page := sanitizeReleaseURL(rel.HTMLURL); page != "" {
		return page
	}
	for _, a := range rel.Assets {
		raw := strings.TrimSpace(a.BrowserDownloadURL)
		if raw == "" {
			raw = strings.TrimSpace(a.URL)
		}
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || !allowedReleaseHost(u.Hostname()) {
			continue
		}
		if i := strings.Index(u.Path, "/releases/"); i > 0 {
			return u.Scheme + "://" + u.Host + u.Path[:i] + "/releases"
		}
	}
	return ""
}

// sanitizeReleaseURL returns raw when it is an https URL on a host owned by
// the release platform, and "" otherwise (host allowlist + no userinfo escape).
func sanitizeReleaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" {
		return ""
	}
	if !allowedReleaseHost(u.Hostname()) {
		platform.Logger().Warn("rejected release page URL from untrusted host", "host", u.Hostname())
		return ""
	}
	return u.String()
}

// allowedReleaseHost reports whether host is gitee.com / github.com or a
// subdomain of either. It is an exact suffix match on label boundaries, so
// "gitee.com.evil.example" and "notgitee.com" are rejected.
func allowedReleaseHost(host string) bool {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	for _, base := range []string{"gitee.com", "github.com"} {
		if h == base || strings.HasSuffix(h, "."+base) {
			return true
		}
	}
	return false
}

// truncateNotes trims the notes and reports whether anything was cut.
func truncateNotes(body string) (string, bool) {
	notes := strings.TrimSpace(body)
	if notes == "" {
		return "", false
	}
	runes := []rune(notes)
	if len(runes) <= maxNotesRunes {
		return notes, false
	}
	return string(runes[:maxNotesRunes]), true
}

// truncateRunes clamps s to at most n runes without splitting a multi-byte
// character.
func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n])
}
