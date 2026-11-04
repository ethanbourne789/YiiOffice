package bridge

import (
	"strings"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
)

// Event names emitted to the frontend via platform.Emit.
const (
	EventTabsChanged            = "tabs:changed"
	EventThemeChanged           = "app:theme-changed"
	EventLanguageChanged        = "app:language-changed"
	EventDocumentThemeChanged   = "app:document-theme-changed"
	EventAutoSaveDefaultChanged = "app:auto-save-default-changed"
	EventUpdateDownloaded       = "app:update-downloaded"
	EventUpdateError            = "app:update-error"
	EventHomeFileRenamed        = "home:file-renamed"
	EventYiiOfficeViewImage     = "yiioffice:view-image"
)

// --- Recents paging (shared with HomeService) ---

// RecentPageQuery is a recents page request. Cursor is the opaque token
// returned as RecentPageResult.NextCursor by the previous page; an empty
// cursor starts at the newest record. Ext scopes the page to one filter family
// and, like Limit, does not affect the counters.
type RecentPageQuery struct {
	Cursor string `json:"cursor,omitempty"`
	Limit  int    `json:"limit,omitempty"`
	Ext    string `json:"ext,omitempty"`
}

// RecentPageResult is one page of recents plus the counters the home screen
// needs: Total is the filtered count, TotalAll the unfiltered collection size.
type RecentPageResult struct {
	Entries    []host.DocumentEntry `json:"entries"`
	Total      int                  `json:"total"`
	TotalAll   int                  `json:"totalAll"`
	NextCursor string               `json:"nextCursor"`
}

// --- Search types (shared with HomeService) ---

// FileSearchQuery mirrors the frontend FileSearchQuery.
type FileSearchQuery struct {
	Q      string `json:"q"`
	Ext    string `json:"ext,omitempty"`
	Offset int    `json:"offset,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

// FileSearchIndex mirrors the frontend FileSearchPage.index object: how many
// files the index holds, how many of the running scan's files are still queued,
// and whether a scan is in progress. The search UI polls while pending > 0 or
// scanning is true, so these values have to describe the live scan.
type FileSearchIndex struct {
	Indexed  int  `json:"indexed"`
	Pending  int  `json:"pending"`
	Scanning bool `json:"scanning"`
}

// FileSearchUnavailable mirrors the frontend FileSearchPage.unavailable object.
type FileSearchUnavailable struct {
	Reason string `json:"reason"`
}

// FileSearchPage mirrors the frontend FileSearchPage.
type FileSearchPage struct {
	Hits        []SearchHitWithStar    `json:"hits"`
	Total       int                    `json:"total"`
	Index       FileSearchIndex        `json:"index"`
	Unavailable *FileSearchUnavailable `json:"unavailable,omitempty"`
}

// SearchHitWithStar extends index.SearchHit with a starred flag.
type SearchHitWithStar struct {
	Path      string              `json:"path"`
	Name      string              `json:"name"`
	Ext       string              `json:"ext"`
	MtimeMs   int64               `json:"mtimeMs"`
	SizeBytes int64               `json:"sizeBytes"`
	Snippet   []index.SnippetPart `json:"snippet"`
	Needles   []string            `json:"needles"`
	Excerpt   string              `json:"excerpt"`
	Starred   bool                `json:"starred"`
}

// resolveExtFamily maps a search extension filter to its family of extensions.
func resolveExtFamily(ext string) []string {
	if ext == "" {
		return nil
	}
	ext = strings.ToLower(strings.TrimSpace(ext))
	family := map[string][]string{
		"docx":     {"docx", "doc"},
		"xlsx":     {"xlsx", "xlsm", "xls", "csv", "tsv"},
		"pptx":     {"pptx", "ppt"},
		"pdf":      {"pdf"},
		"md":       {"md", "markdown"},
		"markdown": {"md", "markdown"},
	}
	if fam, ok := family[ext]; ok {
		return fam
	}
	return []string{ext}
}
