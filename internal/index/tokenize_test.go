package index

import (
	"reflect"
	"testing"
)

func TestCJKBigramTokens(t *testing.T) {
	result := Tokenize("你好世界")

	expectedBi := []string{"你好", "好世", "世界"}
	expectedUni := []string{"你", "好", "世", "界"}

	if !reflect.DeepEqual(result.Bi, expectedBi) {
		t.Errorf("bigram tokens mismatch: got %v, want %v", result.Bi, expectedBi)
	}
	if !reflect.DeepEqual(result.Uni, expectedUni) {
		t.Errorf("unigram tokens mismatch: got %v, want %v", result.Uni, expectedUni)
	}
}

func TestSingleCJKChar(t *testing.T) {
	result := Tokenize("你")

	expectedBi := []string{"你"}
	expectedUni := []string{"你"}

	if !reflect.DeepEqual(result.Bi, expectedBi) {
		t.Errorf("bigram tokens mismatch: got %v, want %v", result.Bi, expectedBi)
	}
	if !reflect.DeepEqual(result.Uni, expectedUni) {
		t.Errorf("unigram tokens mismatch: got %v, want %v", result.Uni, expectedUni)
	}
}

func TestWordTokens(t *testing.T) {
	result := Tokenize("hello world")

	expectedBi := []string{"hello", "world"}
	expectedUni := []string{"hello", "world"}

	if !reflect.DeepEqual(result.Bi, expectedBi) {
		t.Errorf("bigram tokens mismatch: got %v, want %v", result.Bi, expectedBi)
	}
	if !reflect.DeepEqual(result.Uni, expectedUni) {
		t.Errorf("unigram tokens mismatch: got %v, want %v", result.Uni, expectedUni)
	}
}

func TestMixedTokens(t *testing.T) {
	result := Tokenize("hello世界world")

	expectedBi := []string{"hello", "世界", "world"}
	expectedUni := []string{"hello", "世", "界", "world"}

	if !reflect.DeepEqual(result.Bi, expectedBi) {
		t.Errorf("bigram tokens mismatch: got %v, want %v", result.Bi, expectedBi)
	}
	if !reflect.DeepEqual(result.Uni, expectedUni) {
		t.Errorf("unigram tokens mismatch: got %v, want %v", result.Uni, expectedUni)
	}
}

func TestEmptyInput(t *testing.T) {
	result := Tokenize("")

	if len(result.Bi) != 0 {
		t.Errorf("expected empty bigram tokens, got %v", result.Bi)
	}
	if len(result.Uni) != 0 {
		t.Errorf("expected empty unigram tokens, got %v", result.Uni)
	}
}

func TestQueryParseBasic(t *testing.T) {
	terms := ParseQuery("hello world")

	if len(terms) != 2 {
		t.Fatalf("expected 2 terms, got %d", len(terms))
	}

	if terms[0].Text != "hello" || terms[0].Negated {
		t.Errorf("first term mismatch: got %+v", terms[0])
	}
	if terms[1].Text != "world" || terms[1].Negated {
		t.Errorf("second term mismatch: got %+v", terms[1])
	}
}

func TestQueryParseNegation(t *testing.T) {
	terms := ParseQuery("hello -world")

	if len(terms) != 2 {
		t.Fatalf("expected 2 terms, got %d", len(terms))
	}

	if terms[0].Text != "hello" || terms[0].Negated {
		t.Errorf("first term mismatch: got %+v", terms[0])
	}
	if terms[1].Text != "world" || !terms[1].Negated {
		t.Errorf("second term should be negated: got %+v", terms[1])
	}
}

func TestQueryParsePhrase(t *testing.T) {
	terms := ParseQuery(`"hello world"`)

	if len(terms) != 1 {
		t.Fatalf("expected 1 term, got %d", len(terms))
	}

	if terms[0].Text != "hello world" || !terms[0].IsPhrase || terms[0].Negated {
		t.Errorf("phrase term mismatch: got %+v", terms[0])
	}
}

func TestBuildMatchExpr(t *testing.T) {
	terms := []QueryTerm{
		{Text: "hello", Negated: false, BigramSafe: true},
		{Text: "world", Negated: true, BigramSafe: true},
	}

	expr := BuildMatchExpr(terms)
	expected := `'hello' -'world'`

	if expr != expected {
		t.Errorf("match expr mismatch: got %q, want %q", expr, expected)
	}
}

func TestBigramSafe(t *testing.T) {
	if bigramSafe("hello") {
		// OK
	} else {
		t.Error("expected Latin term 'hello' to be bigram safe")
	}

	if bigramSafe("你好") {
		t.Error("expected CJK term '你好' NOT to be bigram safe")
	}

	if !bigramSafe("") {
		t.Error("expected empty string to be bigram safe")
	}
}
