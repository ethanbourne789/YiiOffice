package update

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPatchReleaseAssetsCopiesBrowserDownloadURL(t *testing.T) {
	body := []byte(`{"tag_name":"v1.2.3","assets":[{"name":"a.exe","browser_download_url":"https://gitee.com/dl/a.exe"}]}`)
	out, ok := patchReleaseAssets(body)
	if !ok {
		t.Fatal("expected the payload to be patched")
	}
	var got struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		} `json:"assets"`
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("patched body: %v", err)
	}
	if got.TagName != "v1.2.3" || len(got.Assets) != 1 || got.Assets[0].URL != "https://gitee.com/dl/a.exe" {
		t.Fatalf("patched payload = %s", out)
	}
}

func TestPatchReleaseAssetsLeavesGitHubShapeAlone(t *testing.T) {
	body := []byte(`{"tag_name":"v1.2.3","assets":[{"name":"a.exe","url":"https://api.github.com/asset/1","browser_download_url":"https://gh/dl"}]}`)
	if _, ok := patchReleaseAssets(body); ok {
		t.Fatal("expected no rewrite when url is already present")
	}
}

func TestPatchReleaseAssetsRejectsNonReleaseBodies(t *testing.T) {
	for _, body := range []string{`{"message":"not found"}`, `[]`, `not json`} {
		if _, ok := patchReleaseAssets([]byte(body)); ok {
			t.Errorf("body %q should not be treated as a release payload", body)
		}
	}
}

// TestTransportPatchesListEndpoint covers the Prerelease path: /releases
// returns a JSON array of releases, and every asset must be patched.
func TestTransportPatchesListEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"tag_name":"v2.0.0","assets":[{"name":"b.exe","browser_download_url":"https://gitee.com/dl/b.exe"}]}]`))
	}))
	t.Cleanup(server.Close)

	client := &http.Client{Transport: giteeCompatTransport{base: http.DefaultTransport}}
	resp, err := client.Get(server.URL + "/repos/x/y/releases")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	var list []struct {
		Assets []struct {
			URL string `json:"url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(list) != 1 || len(list[0].Assets) != 1 || list[0].Assets[0].URL != "https://gitee.com/dl/b.exe" {
		t.Fatalf("patched list = %+v", list)
	}
}

// TestCheckPatchesGiteeShapedAsset is the regression for the v3.1.0 provider
// reading "url" instead of "browser_download_url": a Gitee-shaped release
// (no url field) must still yield a usable download URL in the metadata.
func TestCheckPatchesGiteeShapedAsset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/"+repository+"/releases/latest" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"tag_name":"v9.9.9",
			"assets":[{"name":"YiiOffice_9.9.9_windows_amd64_setup.exe","size":2048,"browser_download_url":"https://gitee.com/dl/setup.exe"}]
		}`))
	}))
	t.Cleanup(server.Close)

	rel, err := check(t, server.URL, "0.13.0")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if rel == nil {
		t.Fatal("expected a release, got nil")
	}
	if got, want := rel.Metadata["github.asset.url"], "https://gitee.com/dl/setup.exe"; got != want {
		t.Errorf("asset url = %v, want %s", got, want)
	}
	if rel.Artifact.Filename != "YiiOffice_9.9.9_windows_amd64_setup.exe" {
		t.Errorf("artifact = %+v", rel.Artifact)
	}
}
