package bridge

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFilterDroppedPaths(t *testing.T) {
	dir := t.TempDir()
	write := func(name string) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		return path
	}

	docx := write("deck.docx")
	pdf := write("deck.pdf")
	exe := write("deck.exe")
	txt := write("notes.txt")
	json := write("data.json")
	legacyDoc := write("old.doc")
	legacyXls := write("old.xls")
	legacyPpt := write("old.ppt")
	subdir := filepath.Join(dir, "folder.docx")
	if err := os.Mkdir(subdir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{
			name: "keeps supported existing files",
			in:   []string{docx, pdf},
			want: []string{docx, pdf},
		},
		{
			name: "keeps markdown text and json files",
			in:   []string{txt, json},
			want: []string{txt, json},
		},
		{
			name: "drops legacy binary office formats",
			in:   []string{legacyDoc, legacyXls, legacyPpt},
			want: nil,
		},
		{
			name: "drops unsupported extension",
			in:   []string{exe},
			want: nil,
		},
		{
			name: "drops missing path",
			in:   []string{filepath.Join(dir, "missing.md")},
			want: nil,
		},
		{
			name: "drops directory",
			in:   []string{subdir},
			want: nil,
		},
		{
			name: "removes duplicates case-insensitively",
			in:   []string{docx, docx, filepath.Join(dir, "DECK.DOCX")},
			want: []string{docx},
		},
		{
			name: "skips blank entries",
			in:   []string{"", "   "},
			want: nil,
		},
		{
			name: "mixed drop keeps only the openable ones in order",
			in:   []string{exe, pdf, filepath.Join(dir, "missing.md"), docx},
			want: []string{pdf, docx},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := FilterDroppedPaths(tc.in)
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
}

func TestLegacyDroppedPaths(t *testing.T) {
	dir := t.TempDir()
	write := func(name string) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		return path
	}

	doc := write("old.doc")
	xls := write("old.xls")
	ppt := write("old.ppt")
	docx := write("new.docx")
	subdir := filepath.Join(dir, "folder.xls")
	if err := os.Mkdir(subdir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	got := legacyDroppedPaths([]string{doc, "", "  ", xls, doc, filepath.Join(dir, "missing.ppt"), subdir, ppt, docx})
	want := []string{doc, xls, ppt}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestLegacyDropNotice(t *testing.T) {
	paths := []string{"a.doc", "b.xls", "c.ppt", "d.doc"}

	zh := legacyDropNotice(paths, "zh")
	for _, want := range []string{"旧版格式暂不支持", `"a.doc"`, `"b.xls"`, `"c.ppt"`, "另有 1 个", ".docx / .xlsx / .pptx"} {
		if !strings.Contains(zh, want) {
			t.Errorf("zh notice %q does not contain %q", zh, want)
		}
	}

	en := legacyDropNotice(paths[:1], "en")
	for _, want := range []string{"Legacy formats are not supported", `"a.doc"`, ".docx / .xlsx / .pptx"} {
		if !strings.Contains(en, want) {
			t.Errorf("en notice %q does not contain %q", en, want)
		}
	}
}
