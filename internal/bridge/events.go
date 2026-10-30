package bridge

import (
	"strings"

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

// --- Search types (shared with HomeService) ---

// FileSearchQuery mirrors the frontend FileSearchQuery.
type FileSearchQuery struct {
	Q      string `json:"q"`
	Ext    string `json:"ext,omitempty"`
	Offset int    `json:"offset,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

// FileSearchPage mirrors the frontend FileSearchPage.
type FileSearchPage struct {
	Hits        []SearchHitWithStar `json:"hits"`
	Total       int                 `json:"total"`
	Index       string              `json:"index"`
	Unavailable *string             `json:"unavailable,omitempty"`
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
		"markdown": {"md", "markdown"},
	}
	if fam, ok := family[ext]; ok {
		return fam
	}
	return []string{ext}
}
