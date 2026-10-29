package index

import (
	"strings"
	"testing"
)

func TestBuildSnippetBasic(t *testing.T) {
	text := "The quick brown fox jumps over the lazy dog near the river"
	parts := BuildSnippet(text, []string{"fox"})

	if parts == nil {
		t.Fatal("expected snippet parts, got nil")
	}

	foundHit := false
	for _, p := range parts {
		if p.Hit {
			foundHit = true
			if !strings.Contains(strings.ToLower(p.Text), "fox") {
				t.Errorf("expected hit text to contain 'fox', got %q", p.Text)
			}
		}
	}
	if !foundHit {
		t.Error("expected at least one hit part")
	}
}

func TestBuildSnippetNoMatch(t *testing.T) {
	text := "the quick brown fox"
	parts := BuildSnippet(text, []string{"zzzzz"})

	if parts != nil {
		t.Errorf("expected nil for no match, got %v parts", len(parts))
	}
}

func TestBuildSnippetEmpty(t *testing.T) {
	parts := BuildSnippet("", []string{"needle"})
	if parts != nil {
		t.Errorf("expected nil for empty text, got %v parts", len(parts))
	}

	parts = BuildSnippet("some text", nil)
	if parts != nil {
		t.Errorf("expected nil for empty needles, got %v parts", len(parts))
	}
}

func TestBuildSnippetCJK(t *testing.T) {
	text := "这是一个中文搜索测试用例，用于验证中文分词功能"
	parts := BuildSnippet(text, []string{"中文"})

	if parts == nil {
		t.Fatal("expected snippet parts for CJK, got nil")
	}

	found := false
	for _, p := range parts {
		if p.Hit && strings.Contains(p.Text, "中文") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected hit part containing '中文'")
	}
}

func TestBuildSnippetMultipleNeedles(t *testing.T) {
	text := "go rust python are all programming languages"
	parts := BuildSnippet(text, []string{"go", "rust", "python"})

	if parts == nil {
		t.Fatal("expected snippet parts, got nil")
	}

	hitCount := 0
	for _, p := range parts {
		if p.Hit {
			hitCount++
		}
	}
	if hitCount < 1 {
		t.Error("expected at least one hit part for multiple needles")
	}
}

func TestBuildSnippetEllipsis(t *testing.T) {
	// Build a long text where the needle is in the middle
	long := strings.Repeat("word ", 50) + "target" + strings.Repeat(" word", 50)
	parts := BuildSnippet(long, []string{"target"})

	if parts == nil {
		t.Fatal("expected snippet parts, got nil")
	}

	// First part should start with ellipsis
	if len(parts) > 0 && !strings.HasPrefix(parts[0].Text, "\u2026") {
		t.Error("expected first part to start with ellipsis")
	}

	// Last part should end with ellipsis
	last := parts[len(parts)-1]
	if !strings.HasSuffix(last.Text, "\u2026") {
		t.Error("expected last part to end with ellipsis")
	}
}

func TestBuildExcerpt(t *testing.T) {
	text := "some introductory text here and then the target word appears finally"
	excerpt := BuildExcerpt(text, []string{"target"}, 60)

	if excerpt == "" {
		t.Fatal("expected non-empty excerpt")
	}

	if !strings.Contains(strings.ToLower(excerpt), "target") {
		t.Errorf("excerpt should contain 'target', got %q", excerpt)
	}
}

func TestBuildExcerptEmpty(t *testing.T) {
	excerpt := BuildExcerpt("", []string{"needle"}, 100)
	if excerpt != "" {
		t.Errorf("expected empty excerpt for empty text, got %q", excerpt)
	}

	excerpt = BuildExcerpt("text", nil, 100)
	if excerpt != "" {
		t.Errorf("expected empty excerpt for nil needles, got %q", excerpt)
	}

	excerpt = BuildExcerpt("text", []string{"needle"}, 0)
	if excerpt != "" {
		t.Errorf("expected empty excerpt for zero chars, got %q", excerpt)
	}
}

func TestMergeRanges(t *testing.T) {
	ranges := []textRange{
		{10, 20},
		{15, 25},
		{50, 60},
	}

	merged := mergeRanges(ranges)

	if len(merged) != 2 {
		t.Fatalf("expected 2 merged ranges, got %d", len(merged))
	}

	if merged[0].Start != 10 || merged[0].End != 25 {
		t.Errorf("expected first merged range [10, 25], got [%d, %d]", merged[0].Start, merged[0].End)
	}

	if merged[1].Start != 50 || merged[1].End != 60 {
		t.Errorf("expected second merged range [50, 60], got [%d, %d]", merged[1].Start, merged[1].End)
	}
}

func TestClamp(t *testing.T) {
	tests := []struct {
		v  int
		lo int
		hi int
		want int
	}{
		{5, 0, 10, 5},
		{-1, 0, 10, 0},
		{15, 0, 10, 10},
		{0, 0, 10, 0},
		{10, 0, 10, 10},
	}

	for _, tc := range tests {
		got := clamp(tc.v, tc.lo, tc.hi)
		if got != tc.want {
			t.Errorf("clamp(%d, %d, %d) = %d, want %d", tc.v, tc.lo, tc.hi, got, tc.want)
		}
	}
}
