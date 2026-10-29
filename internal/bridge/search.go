// Package bridge maps the Electron preload channel surface onto Go handlers.
package bridge

import (
	"context"
	"encoding/json"
	"strings"

	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
)

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
	Path      string            `json:"path"`
	Name      string            `json:"name"`
	Ext       string            `json:"ext"`
	MtimeMs   int64             `json:"mtimeMs"`
	SizeBytes int64             `json:"sizeBytes"`
	Snippet   []index.SnippetPart `json:"snippet"`
	Needles   []string          `json:"needles"`
	Excerpt   string            `json:"excerpt"`
	Starred   bool              `json:"starred"`
}

// RegisterSearch wires the home:search-files channel.
func RegisterSearch(r *Router, idxLc *index.Lifecycle, rm *host.RecentManager) {
	r.Handle(ChannelSearchFiles, func(_ context.Context, args []json.RawMessage) (any, error) {
		// Check index availability
		status := index.GetIndexStatus()
		if !status.Ready {
			reason := status.Reason
			return &FileSearchPage{
				Hits:        []SearchHitWithStar{},
				Total:       0,
				Unavailable: &reason,
			}, nil
		}

		if idxLc == nil {
			reason := "index not initialized"
			return &FileSearchPage{
				Hits:        []SearchHitWithStar{},
				Total:       0,
				Unavailable: &reason,
			}, nil
		}

		query, err := DecodeArg[FileSearchQuery](args, 0)
		if err != nil {
			return nil, err
		}

		// Limit query length to 200 runes
		runes := []rune(query.Q)
		if len(runes) > 200 {
			query.Q = string(runes[:200])
		}

		exts := resolveExtFamily(query.Ext)

		store := idxLc.Store()
		result, err := store.Search(query.Q, index.SearchOptions{
			Ext:    exts,
			Offset: query.Offset,
			Limit:  query.Limit,
		})
		if err != nil {
			return nil, err
		}

		hits := make([]SearchHitWithStar, len(result.Hits))
		for i, h := range result.Hits {
			body, _ := store.GetBody(h.Path)
			var snippet []index.SnippetPart
			var excerpt string
			if body != nil {
				snippet = index.BuildSnippet(*body, []string{query.Q})
				excerpt = index.BuildExcerpt(*body, []string{query.Q}, 200)
			}

			hits[i] = SearchHitWithStar{
				Path:      h.Path,
				Name:      h.Name,
				Ext:       h.Ext,
				MtimeMs:   h.MtimeMs,
				SizeBytes: h.SizeBytes,
				Snippet:   snippet,
				Needles:   []string{query.Q},
				Excerpt:   excerpt,
				Starred:   rm.IsStarred(h.Path),
			}
		}

		return &FileSearchPage{
			Hits:  hits,
			Total: result.Total,
			Index: "ok",
		}, nil
	})
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
