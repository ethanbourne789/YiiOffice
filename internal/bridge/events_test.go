package bridge

import (
	"reflect"
	"testing"
)

func TestResolveExtFamilyDocx(t *testing.T) {
	result := resolveExtFamily("docx")
	expected := []string{"docx", "doc"}
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestResolveExtFamilyXlsx(t *testing.T) {
	result := resolveExtFamily("xlsx")
	expected := []string{"xlsx", "xlsm", "xls", "csv", "tsv"}
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestResolveExtFamilyPptx(t *testing.T) {
	result := resolveExtFamily("pptx")
	expected := []string{"pptx", "ppt"}
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestResolveExtFamilyPdf(t *testing.T) {
	result := resolveExtFamily("pdf")
	expected := []string{"pdf"}
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestResolveExtFamilyMarkdown(t *testing.T) {
	result := resolveExtFamily("markdown")
	expected := []string{"md", "markdown"}
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestResolveExtFamilyUnknown(t *testing.T) {
	result := resolveExtFamily("unknown")
	expected := []string{"unknown"}
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestResolveExtFamilyEmpty(t *testing.T) {
	result := resolveExtFamily("")
	if result != nil {
		t.Fatalf("expected nil for empty ext, got %v", result)
	}
}

func TestResolveExtFamilyWhitespace(t *testing.T) {
	result := resolveExtFamily("  docx  ")
	expected := []string{"docx", "doc"}
	if !reflect.DeepEqual(result, expected) {
		t.Fatalf("expected %v, got %v", expected, result)
	}
}

func TestResolveExtFamilyCaseInsensitive(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"DOCX", []string{"docx", "doc"}},
		{"Docx", []string{"docx", "doc"}},
		{"XLSX", []string{"xlsx", "xlsm", "xls", "csv", "tsv"}},
		{"Pptx", []string{"pptx", "ppt"}},
		{"PDF", []string{"pdf"}},
		{"Markdown", []string{"md", "markdown"}},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			result := resolveExtFamily(tc.input)
			if !reflect.DeepEqual(result, tc.expected) {
				t.Fatalf("expected %v, got %v", tc.expected, result)
			}
		})
	}
}
