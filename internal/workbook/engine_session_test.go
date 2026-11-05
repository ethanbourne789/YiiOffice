package workbook

import (
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"
)

// TestEngineEvictsLeastRecentlyUsed guards V-M7: the session map used to grow
// without bound, so every workbook a user ever opened kept its excelize file
// (and its whole parsed sheet cache) resident for the life of the process.
func TestEngineEvictsLeastRecentlyUsed(t *testing.T) {
	path := fixture(t)
	e := NewEngine()
	e.maxSessions = 2

	first, err := e.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := e.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	// Stamp recency deterministically: wall-clock ordering of three opens in a
	// row is too coarse to rely on.
	e.sessions[first.SessionID].lastUsed.Store(2)
	e.sessions[second.SessionID].lastUsed.Store(1)

	if _, err := e.Open(path); err != nil {
		t.Fatal(err)
	}
	if got := e.SessionCount(); got != 2 {
		t.Fatalf("expected the cap to hold 2 sessions, got %d", got)
	}
	if _, err := e.Info(second.SessionID); err == nil {
		t.Fatal("expected the least-recently-used session to be evicted")
	}
	if _, err := e.Info(first.SessionID); err != nil {
		t.Fatalf("recently used session must survive, got %v", err)
	}
}

func TestCloseWipesStoredPassword(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret.xlsx")
	f := excelize.NewFile()
	if err := f.SetCellValue(f.GetSheetName(0), "A1", "classified"); err != nil {
		t.Fatal(err)
	}
	if err := f.SaveAs(path, excelize.Options{Password: "s3cret"}); err != nil {
		t.Skipf("excelize cannot encrypt in this build: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	e := NewEngine()
	info, err := e.OpenWithPassword(path, "s3cret")
	if err != nil {
		t.Fatalf("open encrypted workbook: %v", err)
	}
	s := e.sessions[info.SessionID]
	if string(s.password) != "s3cret" {
		t.Fatalf("expected the key to be retained for re-saves, got %q", s.password)
	}
	if err := e.Close(info.SessionID); err != nil {
		t.Fatal(err)
	}
	for i, b := range s.password {
		if b != 0 {
			t.Fatalf("password byte %d not wiped after close: %v", i, s.password)
		}
	}
}
