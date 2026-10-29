package index

import (
	"regexp"
	"strings"
	"unicode"
)

const (
	snippetWindow = 150
	snippetLead   = 40
)

var whitespaceRe = regexp.MustCompile(`\s+`)

// BuildSnippet creates a highlighted snippet from body text and search needles.
// Returns nil if no hits.
func BuildSnippet(text string, needles []string) []SnippetPart {
	if text == "" || len(needles) == 0 {
		return nil
	}

	normalized := whitespaceRe.ReplaceAllString(text, " ")
	normalized = strings.TrimSpace(normalized)
	if normalized == "" {
		return nil
	}

	lower := strings.ToLower(normalized)

	// Find all needle positions
	ranges := findTextRanges(lower, needles)
	if len(ranges) == 0 {
		return nil
	}

	// Window around first hit (by rune index)
	runes := []rune(normalized)
	lowerRunes := []rune(lower)

	// Recalculate ranges in rune space
	runeRanges := findTextRangesInRunes(lowerRunes, needles)
	if len(runeRanges) == 0 {
		return nil
	}

	firstHit := runeRanges[0].Start
	start := clamp(firstHit-snippetLead, 0, len(runes))
	end := clamp(start+snippetWindow, start, len(runes))

	window := runes[start:end]

	// Adjust hit positions to window coordinates
	var hitRanges []textRange
	for _, r := range runeRanges {
		adj := textRange{
			Start: r.Start - start,
			End:   r.End - start,
		}
		if adj.End <= 0 || adj.Start >= len(window) {
			continue
		}
		adj.Start = max(0, adj.Start)
		adj.End = min(len(window), adj.End)
		hitRanges = append(hitRanges, adj)
	}
	hitRanges = mergeRanges(hitRanges)

	// Build parts
	var parts []SnippetPart
	pos := 0
	for _, r := range hitRanges {
		if r.Start > pos {
			parts = append(parts, SnippetPart{Text: string(window[pos:r.Start]), Hit: false})
		}
		parts = append(parts, SnippetPart{Text: string(window[r.Start:r.End]), Hit: true})
		pos = r.End
	}
	if pos < len(window) {
		parts = append(parts, SnippetPart{Text: string(window[pos:]), Hit: false})
	}

	// Add ellipsis
	if start > 0 {
		parts[0].Text = "\u2026" + parts[0].Text
	}
	if end < len(runes) {
		parts[len(parts)-1].Text = parts[len(parts)-1].Text + "\u2026"
	}

	return parts
}

// BuildExcerpt creates a plain-text excerpt around the first match.
func BuildExcerpt(text string, needles []string, chars int) string {
	if text == "" || len(needles) == 0 || chars <= 0 {
		return ""
	}

	normalized := whitespaceRe.ReplaceAllString(text, " ")
	normalized = strings.TrimSpace(normalized)
	lower := strings.ToLower(normalized)

	runes := []rune(normalized)
	lowerRunes := []rune(lower)

	runeRanges := findTextRangesInRunes(lowerRunes, needles)
	if len(runeRanges) == 0 {
		return ""
	}

	firstHit := runeRanges[0].Start
	lead := chars / 4
	tail := chars - lead
	start := clamp(firstHit-lead, 0, len(runes))
	end := clamp(start+tail, start, len(runes))

	excerpt := string(runes[start:end])
	if start > 0 {
		excerpt = "\u2026" + excerpt
	}
	if end < len(runes) {
		excerpt = excerpt + "\u2026"
	}
	return excerpt
}

type textRange struct {
	Start int
	End   int
}

// findTextRanges finds all occurrences of needles in text (byte-level).
func findTextRanges(text string, needles []string) []textRange {
	var result []textRange
	for _, needle := range needles {
		needleLower := strings.ToLower(needle)
		start := 0
		for {
			idx := strings.Index(text[start:], needleLower)
			if idx == -1 {
				break
			}
			result = append(result, textRange{Start: start + idx, End: start + idx + len(needleLower)})
			start = start + idx + 1
		}
	}
	return result
}

// findTextRangesInRunes finds all occurrences of needles in runes.
func findTextRangesInRunes(text []rune, needles []string) []textRange {
	textStr := string(text)
	textLower := strings.ToLower(textStr)
	var result []textRange
	for _, needle := range needles {
		needleLower := strings.ToLower(needle)
		needleRunes := []rune(needleLower)
		n := len(needleRunes)
		if n == 0 {
			continue
		}
		for i := 0; i <= len(textLower)-len(needleLower); i++ {
			// Check at rune boundary
			if textLower[i:i+len(needleLower)] == needleLower {
				// Convert byte index to rune index
				runeIdx := len([]rune(textLower[:i]))
				result = append(result, textRange{Start: runeIdx, End: runeIdx + n})
				i += len(needleLower) - 1
			}
		}
	}
	return result
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func mergeRanges(ranges []textRange) []textRange {
	if len(ranges) == 0 {
		return nil
	}
	// Sort by start
	for i := 1; i < len(ranges); i++ {
		for j := i; j > 0 && ranges[j].Start < ranges[j-1].Start; j-- {
			ranges[j], ranges[j-1] = ranges[j-1], ranges[j]
		}
	}

	merged := []textRange{ranges[0]}
	for i := 1; i < len(ranges); i++ {
		last := &merged[len(merged)-1]
		if ranges[i].Start <= last.End {
			last.End = max(last.End, ranges[i].End)
		} else {
			merged = append(merged, ranges[i])
		}
	}
	return merged
}

// _ to avoid "unicode" imported and not used if we don't use it directly.
var _ = unicode.IsSpace
