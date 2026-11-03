package update

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// giteeCompatTransport adapts Gitee's release payloads to the Wails v3.1.0
// github provider. v3.1.0 reads an asset's API "url" field for the download
// step, but the Gitee API v5 attachment shape only carries
// "browser_download_url" (verified against live Gitee releases). Without this
// patch the provider would stash an empty URL in the release metadata and
// DownloadAndInstall would fail with "release metadata missing asset URL".
// The transport copies browser_download_url into url for every asset so the
// provider keeps working against Gitee's GitHub-shaped API.
type giteeCompatTransport struct {
	base http.RoundTripper
}

func (t giteeCompatTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := t.base.RoundTrip(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		return resp, err
	}
	if !strings.Contains(req.URL.Path, "/releases") {
		return resp, nil
	}
	body, readErr := io.ReadAll(resp.Body)
	closeErr := resp.Body.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	patched, ok := patchReleaseAssets(body)
	if !ok {
		patched = body
	}
	resp.Body = io.NopCloser(bytes.NewReader(patched))
	resp.ContentLength = int64(len(patched))
	resp.Header.Set("Content-Length", strconv.Itoa(len(patched)))
	return resp, nil
}

// patchReleaseAssets rewrites "url" from "browser_download_url" for every
// asset of a release payload (single object or list). ok is false when the
// body is not a release payload or needs no rewrite, and the caller must
// leave the body untouched.
func patchReleaseAssets(body []byte) ([]byte, bool) {
	var single map[string]any
	if json.Unmarshal(body, &single) == nil {
		if _, hasTag := single["tag_name"]; !hasTag {
			return nil, false
		}
		if !patchAssets(single["assets"]) {
			return nil, false
		}
		out, err := json.Marshal(single)
		return out, err == nil
	}
	var list []map[string]any
	if json.Unmarshal(body, &list) == nil {
		changed := false
		for _, item := range list {
			if _, hasTag := item["tag_name"]; !hasTag {
				return nil, false
			}
			changed = patchAssets(item["assets"]) || changed
		}
		if !changed {
			return nil, false
		}
		out, err := json.Marshal(list)
		return out, err == nil
	}
	return nil, false
}

func patchAssets(v any) bool {
	assets, ok := v.([]any)
	if !ok {
		return false
	}
	changed := false
	for _, a := range assets {
		asset, ok := a.(map[string]any)
		if !ok {
			continue
		}
		if url, hasURL := asset["url"].(string); (!hasURL || url == "") {
			if bdu, is := asset["browser_download_url"].(string); is && bdu != "" {
				asset["url"] = bdu
				changed = true
			}
		}
	}
	return changed
}
