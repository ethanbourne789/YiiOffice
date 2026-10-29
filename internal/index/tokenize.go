package index

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// isCJK returns true for CJK ideographs, kana, hangul, and related scripts.
func isCJK(r rune) bool {
	return (r >= 0x2E80 && r <= 0x9FFF) ||
		(r >= 0xF900 && r <= 0xFAFF) ||
		(r >= 0xFB00 && r <= 0xFB06) ||
		(r >= 0xAC00 && r <= 0xD7A3) ||
		(r >= 0x1100 && r <= 0x11FF) ||
		(r >= 0x3130 && r <= 0x318F) ||
		(r >= 0xA960 && r <= 0xA97C) ||
		(r >= 0xD7B0 && r <= 0xD7FF) ||
		(r >= 0x20000 && r <= 0x2FFFF) ||
		(r >= 0x3040 && r <= 0x30FF)
}

// TokenResult holds the token streams for FTS indexing.
type TokenResult struct {
	Bi  []string // bigram tokens
	Uni []string // unigram tokens
}

// Tokenize text into bigram and unigram streams.
func Tokenize(text string) TokenResult {
	folded := strings.ToLower(norm.NFKC.String(text))
	if folded == "" {
		return TokenResult{}
	}

	var bi, uni []string
	var runStart int
	var runIsCJK bool

	for i, r := range folded {
		currentIsCJK := isCJK(r)
		if i == runStart {
			runIsCJK = currentIsCJK
			continue
		}
		if currentIsCJK != runIsCJK {
			// Flush previous run
			runText := folded[runStart:i]
			if runIsCJK {
				cjkTokens := cjkBigramAndUnigram(runText)
				bi = append(bi, cjkTokens.Bi...)
				uni = append(uni, cjkTokens.Uni...)
			} else {
				wordTokens := wordTokensSplit(runText)
				bi = append(bi, wordTokens...)
				uni = append(uni, wordTokens...)
			}
			runStart = i
			runIsCJK = currentIsCJK
		}
	}

	// Flush last run
	runText := folded[runStart:]
	if runIsCJK {
		cjkTokens := cjkBigramAndUnigram(runText)
		bi = append(bi, cjkTokens.Bi...)
		uni = append(uni, cjkTokens.Uni...)
	} else {
		wordTokens := wordTokensSplit(runText)
		bi = append(bi, wordTokens...)
		uni = append(uni, wordTokens...)
	}

	return TokenResult{Bi: bi, Uni: uni}
}

func cjkBigramAndUnigram(s string) TokenResult {
	runes := []rune(s)
	n := len(runes)

	var bi, uni []string
	for _, r := range runes {
		uni = append(uni, string(r))
	}
	for i := 0; i < n-1; i++ {
		bi = append(bi, string(runes[i:i+2]))
	}
	if n == 1 {
		bi = append(bi, uni[0])
	}
	return TokenResult{Bi: bi, Uni: uni}
}

// wordTokensSplit splits a non-CJK run into whitespace/punctuation-separated words.
func wordTokensSplit(s string) []string {
	var tokens []string
	var current strings.Builder

	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '-' || r == '_' || r == '\'' {
			current.WriteRune(r)
		} else {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
		}
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

// ----- Query parsing -----

// QueryTerm represents a parsed search term.
type QueryTerm struct {
	Text       string
	Negated    bool
	IsPhrase   bool
	BigramSafe bool // true when the term is suitable for bigram column search
}

// ParseQuery parses a search query into terms.
func ParseQuery(input string) []QueryTerm {
	input = strings.TrimSpace(input)
	if input == "" {
		return nil
	}

	var terms []QueryTerm
	i := 0
	n := len(input)

	for i < n {
		// Skip whitespace
		for i < n && unicode.IsSpace(rune(input[i])) {
			i++
		}
		if i >= n {
			break
		}

		negated := false
		if input[i] == '-' {
			negated = true
			i++
			// Skip whitespace after negation
			for i < n && unicode.IsSpace(rune(input[i])) {
				i++
			}
		}

		if i < n && input[i] == '"' {
			// Phrase
			i++
			start := i
			for i < n && input[i] != '"' {
				i++
			}
			phrase := input[start:i]
			if i < n {
				i++ // closing quote
			}
			terms = append(terms, QueryTerm{Text: phrase, Negated: negated, IsPhrase: true, BigramSafe: true})
		} else {
			// Word
			start := i
			for i < n && !unicode.IsSpace(rune(input[i])) && input[i] != '"' {
				i++
			}
			word := input[start:i]
			terms = append(terms, QueryTerm{Text: word, Negated: negated, BigramSafe: bigramSafe(word)})
		}
	}

	return terms
}

// bigramSafe checks if a term is safe for bigram column search.
// CJK single characters and short terms should use unigram column.
func bigramSafe(term string) bool {
	runes := []rune(term)
	for _, r := range runes {
		if isCJK(r) {
			return false
		}
	}
	return true
}

// BuildMatchExpr builds an FTS5 MATCH expression from parsed query terms.
func BuildMatchExpr(terms []QueryTerm) string {
	if len(terms) == 0 {
		return ""
	}

	var parts []string
	for _, t := range terms {
		escaped := strings.NewReplacer("\\", "\\\\", "'", "\\'").Replace(t.Text)
		expr := "'" + escaped + "'"
		if t.Negated {
			expr = "-" + expr
		}
		parts = append(parts, expr)
	}
	return strings.Join(parts, " ")
}
