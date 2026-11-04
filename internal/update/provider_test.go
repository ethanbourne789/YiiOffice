package update

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testArtifact = "YiiOffice_9.9.9_windows_amd64_setup.exe"

// feedServer serves a GitHub/Gitee-shaped release whose assets point back at
// itself. opts controls whether the release carries a .sha256 asset and what
// that asset returns.
type feedOptions struct {
	sidecarName   string
	sidecarBody   string
	sidecarStatus int
	extraSidecars []string
}

func feedServer(t *testing.T, opts feedOptions) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/repos/"+repository+"/releases/latest":
			host := "http://" + r.Host
			assets := []map[string]any{
				{"name": testArtifact, "size": 16, "browser_download_url": host + "/dl/" + testArtifact},
			}
			if opts.sidecarName != "" {
				assets = append(assets, map[string]any{
					"name": opts.sidecarName, "size": 65,
					"browser_download_url": host + "/dl/" + opts.sidecarName,
				})
			}
			for _, name := range opts.extraSidecars {
				assets = append(assets, map[string]any{
					"name": name, "size": 65, "browser_download_url": host + "/dl/" + name,
				})
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tag_name": "v9.9.9",
				"body":     "Release notes",
				"assets":   assets,
			})
		case strings.HasPrefix(r.URL.Path, "/dl/"):
			name := strings.TrimPrefix(r.URL.Path, "/dl/")
			if name == opts.sidecarName || contains(opts.extraSidecars, name) {
				status := opts.sidecarStatus
				if status == 0 {
					status = http.StatusOK
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(opts.sidecarBody))
				return
			}
			if name == testArtifact {
				_, _ = w.Write([]byte("installer-bytes"))
				return
			}
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func contains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func TestCheckAttachesPublishedDigest(t *testing.T) {
	server := feedServer(t, feedOptions{
		sidecarName: testArtifact + ".sha256",
		sidecarBody: emptySHA256 + "\n",
	})

	rel, err := check(t, server.URL, "0.13.0")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if rel == nil {
		t.Fatal("expected a release")
	}
	if rel.Verification == nil {
		t.Fatal("expected a verification block")
	}
	if rel.Verification.DigestAlgo != "sha256" {
		t.Errorf("digest algorithm = %q", rel.Verification.DigestAlgo)
	}
	if !bytes.Equal(rel.Verification.Digest, mustDigest(t, emptySHA256)) {
		t.Errorf("digest = %x", rel.Verification.Digest)
	}
	if rel.Metadata[metaChecksumMissing] == true {
		t.Error("missing marker set on a release that ships a sidecar")
	}
}

// The sidecar may be uploaded under the installer's pre-rename name; with one
// candidate the provider still picks it up.
func TestCheckUsesSingleSidecarWithDifferentName(t *testing.T) {
	server := feedServer(t, feedOptions{
		sidecarName: "YiiOffice_9.9.9_setup.exe.sha256",
		sidecarBody: emptySHA256 + "  YiiOffice_9.9.9_setup.exe\n",
	})

	rel, err := check(t, server.URL, "0.13.0")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if rel == nil || rel.Verification == nil {
		t.Fatal("expected a release with verification")
	}
	if !bytes.Equal(rel.Verification.Digest, mustDigest(t, emptySHA256)) {
		t.Errorf("digest = %x", rel.Verification.Digest)
	}
}

func TestCheckMarksReleaseWithoutSidecar(t *testing.T) {
	server := feedServer(t, feedOptions{})

	rel, err := check(t, server.URL, "0.13.0")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if rel == nil {
		t.Fatal("expected a release")
	}
	if rel.Verification != nil {
		t.Fatal("no sidecar should leave verification empty")
	}
	if rel.Metadata[metaChecksumMissing] != true {
		t.Errorf("missing marker = %v", rel.Metadata[metaChecksumMissing])
	}
}

func TestCheckFailsOnMalformedSidecar(t *testing.T) {
	server := feedServer(t, feedOptions{
		sidecarName: testArtifact + ".sha256",
		sidecarBody: "not a checksum\n",
	})

	if _, err := check(t, server.URL, "0.13.0"); err == nil {
		t.Fatal("expected a malformed sidecar to abort the check")
	}
}

func TestCheckFailsWhenSidecarCannotBeFetched(t *testing.T) {
	server := feedServer(t, feedOptions{
		sidecarName:   testArtifact + ".sha256",
		sidecarBody:   emptySHA256,
		sidecarStatus: http.StatusInternalServerError,
	})

	_, err := check(t, server.URL, "0.13.0")
	if err == nil {
		t.Fatal("expected a sidecar download failure to abort the check")
	}
	if !strings.Contains(err.Error(), "checksum sidecar") {
		t.Errorf("error should name the sidecar: %v", err)
	}
}

func TestCheckFailsOnAmbiguousSidecars(t *testing.T) {
	server := feedServer(t, feedOptions{
		sidecarName:   "other-one.sha256",
		sidecarBody:   emptySHA256,
		extraSidecars: []string{"another.sha256"},
	})

	if _, err := check(t, server.URL, "0.13.0"); err == nil {
		t.Fatal("expected ambiguous sidecars to abort the check")
	}
}
