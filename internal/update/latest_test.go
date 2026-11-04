package update

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// checkService builds the read-only check against base with no updater state.
func checkService(base, current string) *Service {
	return &Service{
		base:        base,
		current:     current,
		checkClient: &http.Client{Timeout: 5 * time.Second},
	}
}

// checkServerAnswers serves body at the feed's latest-release endpoint and
// 404s everything else.
func checkServerAnswers(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/"+repository+"/releases/latest" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server
}

func TestCheckNowReportsNewerRelease(t *testing.T) {
	server := checkServerAnswers(t, http.StatusOK, `{
		"tag_name":"v0.14.0",
		"name":"YiiOffice 0.14.0",
		"body":"Fix the thing",
		"published_at":"2026-10-01T08:00:00Z",
		"html_url":"https://gitee.com/ethanbourne789/yiioffice/releases/tag/v0.14.0",
		"assets":[{"name":"YiiOffice_0.14.0_windows_amd64_setup.exe"}]
	}`)

	got := checkService(server.URL, "0.13.0").CheckNow()

	if got.Status != checkStatusUpdateAvailable {
		t.Fatalf("status = %q, want %q", got.Status, checkStatusUpdateAvailable)
	}
	if got.CurrentVersion != "0.13.0" {
		t.Errorf("currentVersion = %q", got.CurrentVersion)
	}
	if got.LatestVersion != "v0.14.0" {
		t.Errorf("latestVersion = %q, want the raw tag", got.LatestVersion)
	}
	if got.LatestSemver != "0.14.0" {
		t.Errorf("latestSemver = %q", got.LatestSemver)
	}
	if got.ReleaseName != "YiiOffice 0.14.0" {
		t.Errorf("releaseName = %q", got.ReleaseName)
	}
	if got.Notes != "Fix the thing" {
		t.Errorf("notes = %q", got.Notes)
	}
	if got.PublishedAt != "2026-10-01T08:00:00Z" || got.PublishedAtSource != "published_at" {
		t.Errorf("publishedAt = %q (%q)", got.PublishedAt, got.PublishedAtSource)
	}
	if want := "https://gitee.com/ethanbourne789/yiioffice/releases/tag/v0.14.0"; got.ReleaseURL != want {
		t.Errorf("releaseUrl = %q, want %q", got.ReleaseURL, want)
	}
	if got.CheckedAt == "" {
		t.Error("checkedAt is empty")
	}
}

func TestCheckNowReportsUpToDate(t *testing.T) {
	server := checkServerAnswers(t, http.StatusOK, `{
		"tag_name":"v0.13.0",
		"body":"same build",
		"assets":[{"name":"YiiOffice_0.13.0_setup.exe"}]
	}`)

	got := checkService(server.URL, "0.13.0").CheckNow()
	if got.Status != checkStatusLatest {
		t.Errorf("status = %q, want %q", got.Status, checkStatusLatest)
	}
}

// The live Gitee release (2026-11-03) has tag "YiiOffice", no published_at and
// no html_url. Both the non-semver tag and the two missing fields are what this
// degradation exists for.
func TestCheckNowDegradesOnLiveGiteeShape(t *testing.T) {
	server := checkServerAnswers(t, http.StatusOK, `{
		"tag_name":"YiiOffice",
		"name":"YiiOffice V0.13.0",
		"body":"Create a lightweight, usable, ad-free, no-login Office software.",
		"prerelease":false,
		"created_at":"2026-11-03T14:18:13+08:00",
		"assets":[
			{"browser_download_url":"https://gitee.com/ethanbourne789/YiiOffice/releases/download/YiiOffice/YiiOffice_0.13.0_setup.exe","name":"YiiOffice_0.13.0_setup.exe"},
			{"browser_download_url":"https://gitee.com/ethanbourne789/YiiOffice/archive/refs/tags/YiiOffice.zip","name":"YiiOffice.zip"}
		]
	}`)

	got := checkService(server.URL, "0.13.0").CheckNow()

	if got.Status != checkStatusIncomparable {
		t.Fatalf("status = %q, want %q", got.Status, checkStatusIncomparable)
	}
	if got.LatestVersion != "YiiOffice" {
		t.Errorf("latestVersion = %q, want the raw tag", got.LatestVersion)
	}
	if got.LatestSemver != "" {
		t.Errorf("latestSemver = %q, want empty for a non-semver tag", got.LatestSemver)
	}
	if got.ReleaseName != "YiiOffice V0.13.0" {
		t.Errorf("releaseName = %q", got.ReleaseName)
	}
	if got.PublishedAt != "2026-11-03T06:18:13Z" || got.PublishedAtSource != "created_at" {
		t.Errorf("publishedAt = %q (%q)", got.PublishedAt, got.PublishedAtSource)
	}
	if want := "https://gitee.com/ethanbourne789/YiiOffice/releases"; got.ReleaseURL != want {
		t.Errorf("releaseUrl = %q, want %q", got.ReleaseURL, want)
	}
	if got.Message == "" {
		t.Error("incomparable result should explain what could not be ordered")
	}
}

func TestCheckNowTreatsMissingReleaseAsLatest(t *testing.T) {
	server := checkServerAnswers(t, http.StatusNotFound, `{"message":"404"}`)

	got := checkService(server.URL, "0.13.0").CheckNow()
	if got.Status != checkStatusLatest {
		t.Errorf("status = %q, want %q", got.Status, checkStatusLatest)
	}
	if got.Message != "" {
		t.Errorf("message = %q, want none for an absent release", got.Message)
	}
}

func TestCheckNowReportsFeedFailure(t *testing.T) {
	server := checkServerAnswers(t, http.StatusInternalServerError, "upstream is down")

	got := checkService(server.URL, "0.13.0").CheckNow()
	if got.Status != checkStatusError {
		t.Fatalf("status = %q, want %q", got.Status, checkStatusError)
	}
	if !strings.HasPrefix(got.Message, "update_feed_http_error:") {
		t.Errorf("message should carry the stable code: %q", got.Message)
	}
	if !strings.Contains(got.Message, "HTTP 500") {
		t.Errorf("message should name the HTTP status: %q", got.Message)
	}
	if !strings.Contains(got.Message, "upstream is down") {
		t.Errorf("message should carry the upstream body: %q", got.Message)
	}
}

func TestCheckNowReportsInvalidJSON(t *testing.T) {
	server := checkServerAnswers(t, http.StatusOK, "not json")

	got := checkService(server.URL, "0.13.0").CheckNow()
	if got.Status != checkStatusError {
		t.Fatalf("status = %q, want %q", got.Status, checkStatusError)
	}
	if !strings.HasPrefix(got.Message, "update_feed_invalid:") {
		t.Errorf("message = %q", got.Message)
	}
}

func TestCheckNowRejectsUntrustedReleaseURL(t *testing.T) {
	server := checkServerAnswers(t, http.StatusOK, `{
		"tag_name":"v0.14.0",
		"html_url":"https://gitee.com.evil.example/releases",
		"assets":[{"browser_download_url":"https://gitee.com/ethanbourne789/YiiOffice/releases/download/v0.14.0/x.exe"}]
	}`)

	got := checkService(server.URL, "0.13.0").CheckNow()
	if want := "https://gitee.com/ethanbourne789/YiiOffice/releases"; got.ReleaseURL != want {
		t.Errorf("releaseUrl = %q, want the allowlisted derivation %q", got.ReleaseURL, want)
	}
	if got.Status != checkStatusUpdateAvailable {
		t.Errorf("status = %q", got.Status)
	}
}

func TestCheckNowReportsNoURLWhenNothingIsTrusted(t *testing.T) {
	server := checkServerAnswers(t, http.StatusOK, `{
		"tag_name":"v0.14.0",
		"html_url":"http://evil.example/releases",
		"assets":[{"browser_download_url":"https://evil.example/YiiOffice/releases/download/v0.14.0/x.exe"}]
	}`)

	got := checkService(server.URL, "0.13.0").CheckNow()
	if got.ReleaseURL != "" {
		t.Errorf("releaseUrl = %q, want empty", got.ReleaseURL)
	}
}

func TestCheckNowTruncatesNotes(t *testing.T) {
	notes := strings.Repeat("长", maxNotesRunes+100)
	server := checkServerAnswers(t, http.StatusOK, `{
		"tag_name":"v0.14.0",
		"body":"`+notes+`"
	}`)

	got := checkService(server.URL, "0.13.0").CheckNow()
	if !got.NotesTruncated {
		t.Error("expected notesTruncated")
	}
	if n := len([]rune(got.Notes)); n != maxNotesRunes {
		t.Errorf("notes length = %d runes, want %d", n, maxNotesRunes)
	}
}

func TestSanitizeReleaseURL(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"gitee", "https://gitee.com/o/r/releases", "https://gitee.com/o/r/releases"},
		{"gitee subdomain", "https://api.gitee.com/x", "https://api.gitee.com/x"},
		{"github", "https://github.com/o/r/releases/tag/v1", "https://github.com/o/r/releases/tag/v1"},
		{"lookalike suffix", "https://gitee.com.evil.example/x", ""},
		{"lookalike prefix", "https://notgitee.com/x", ""},
		{"plain http", "http://gitee.com/x", ""},
		{"userinfo", "https://user@gitee.com/x", ""},
		{"empty", "", ""},
		{"relative", "/releases", ""},
	}
	for _, tc := range cases {
		if got := sanitizeReleaseURL(tc.in); got != tc.want {
			t.Errorf("%s: sanitizeReleaseURL(%q) = %q, want %q", tc.name, tc.in, got, tc.want)
		}
	}
}
