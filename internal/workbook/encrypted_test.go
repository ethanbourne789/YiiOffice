package workbook

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/xuri/excelize/v2"
)

// writeEncryptedFixture builds a one-cell workbook, encrypts it with
// excelize (OOXML standard encryption) and returns its path.
func writeEncryptedFixture(t *testing.T, dir, password string) string {
	t.Helper()
	plainPath := filepath.Join(dir, "plain.xlsx")
	f := excelize.NewFile()
	if err := f.SetCellValue("Sheet1", "A1", "secret"); err != nil {
		t.Fatalf("set value: %v", err)
	}
	if err := f.SaveAs(plainPath); err != nil {
		t.Fatalf("save plain fixture: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close plain fixture: %v", err)
	}
	raw, err := os.ReadFile(plainPath)
	if err != nil {
		t.Fatalf("read plain fixture: %v", err)
	}
	encrypted, err := excelize.Encrypt(raw, &excelize.Options{Password: password})
	if err != nil {
		t.Fatalf("encrypt fixture: %v", err)
	}
	encPath := filepath.Join(dir, "encrypted.xlsx")
	if err := os.WriteFile(encPath, encrypted, 0o600); err != nil {
		t.Fatalf("write encrypted fixture: %v", err)
	}
	return encPath
}

// TestEncryptedWorkbookOpenStates covers the three states the renderer must
// tell apart: no password, wrong password and correct password. It also
// checks that a non-container damaged file is reported as corrupt rather
// than as encrypted.
func TestEncryptedWorkbookOpenStates(t *testing.T) {
	dir := t.TempDir()
	encPath := writeEncryptedFixture(t, dir, "s3cret")

	eng := NewEngine()
	defer eng.CloseAll()

	// 1) No password: the workbook must be reported as password-required and
	// the message must carry the path for the renderer's retry.
	if _, err := eng.Open(encPath); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("open without password = %v, want ErrPasswordRequired", err)
	} else if got, want := err.Error(), ErrPasswordRequired.Error()+"|"+encPath; got != want {
		t.Fatalf("password-required message = %q, want %q", got, want)
	}

	// 2) Wrong password.
	if _, err := eng.OpenWithPassword(encPath, "wrong"); !errors.Is(err, ErrPasswordIncorrect) {
		t.Fatalf("wrong password = %v, want ErrPasswordIncorrect", err)
	}

	// 3) Correct password: the real cell value must be readable.
	info, err := eng.OpenWithPassword(encPath, "s3cret")
	if err != nil {
		t.Fatalf("correct password: %v", err)
	}
	result, err := eng.ReadRange(info.SessionID, info.Sheets[0].ID, CellArea{StartRow: 0, StartColumn: 0, EndRow: 0, EndColumn: 0})
	if err != nil {
		t.Fatalf("read decrypted range: %v", err)
	}
	if len(result.Cells) != 1 || result.Cells[0].Value != "secret" {
		t.Fatalf("decrypted cells = %#v", result.Cells)
	}

	// 4) A broken non-encrypted file is corruption, not a password prompt.
	brokenPath := filepath.Join(dir, "broken.xlsx")
	if err := os.WriteFile(brokenPath, []byte("this is not a workbook"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := eng.Open(brokenPath); !errors.Is(err, ErrWorkbookCorrupt) {
		t.Fatalf("broken file = %v, want ErrWorkbookCorrupt", err)
	}
}

// TestEncryptedWorkbookSaveKeepsEncryption pins the save contract chosen for
// encrypted sessions: excelize's WriteToBuffer re-encrypts whenever
// Options.Password is set (file.go:151-158), so both in-place save and save-as
// keep the password instead of silently writing a plaintext workbook.
func TestEncryptedWorkbookSaveKeepsEncryption(t *testing.T) {
	dir := t.TempDir()
	encPath := writeEncryptedFixture(t, dir, "s3cret")

	eng := NewEngine()
	defer eng.CloseAll()
	info, err := eng.OpenWithPassword(encPath, "s3cret")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	edit := CellEdit{SheetID: info.Sheets[0].ID, Row: 0, Column: 0, WriteValue: true, Value: "changed"}

	saved, err := eng.Save(SaveRequest{SessionID: info.SessionID, Mode: "save", Edits: []CellEdit{edit}})
	if err != nil {
		t.Fatalf("in-place save: %v", err)
	}
	if saved.File == nil || saved.File.Path != encPath {
		t.Fatalf("save result = %#v", saved)
	}
	if head := readHeader(t, encPath); !isOLEHeader(head) {
		t.Fatalf("in-place save dropped the encryption container: %v", head)
	}
	// The rewritten file must still be password-gated, and the edit must be
	// visible once the right key is supplied.
	if _, err := eng.Open(encPath); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("reopen saved file without password = %v, want ErrPasswordRequired", err)
	}
	if _, err := eng.OpenWithPassword(encPath, "wrong"); !errors.Is(err, ErrPasswordIncorrect) {
		t.Fatalf("reopen with wrong password = %v, want ErrPasswordIncorrect", err)
	}
	reopened, err := eng.OpenWithPassword(encPath, "s3cret")
	if err != nil {
		t.Fatalf("reopen with correct password: %v", err)
	}
	if got := readA1(t, reopened); got != "changed" {
		t.Fatalf("A1 after in-place save = %q, want %q", got, "changed")
	}

	// Save-as follows the same path: the new file is encrypted too, so the
	// password is never silently downgraded to plaintext.
	copyPath := filepath.Join(dir, "copy.xlsx")
	saved, err = eng.Save(SaveRequest{
		SessionID:  info.SessionID,
		Mode:       "save-as",
		TargetPath: copyPath,
		Edits:      []CellEdit{{SheetID: info.Sheets[0].ID, Row: 0, Column: 1, WriteValue: true, Value: "copied"}},
	})
	if err != nil {
		t.Fatalf("save-as: %v", err)
	}
	if saved.File == nil || saved.File.Path != copyPath {
		t.Fatalf("save-as result = %#v", saved)
	}
	if head := readHeader(t, copyPath); !isOLEHeader(head) {
		t.Fatalf("save-as wrote a plaintext workbook: %v", head)
	}
	if _, err := eng.Open(copyPath); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("open copy without password = %v, want ErrPasswordRequired", err)
	}
	copyInfo, err := eng.OpenWithPassword(copyPath, "s3cret")
	if err != nil {
		t.Fatalf("open copy with password: %v", err)
	}
	if got := readA1(t, copyInfo); got != "changed" {
		t.Fatalf("copy A1 = %q, want %q", got, "changed")
	}
}

func readHeader(t *testing.T, path string) []byte {
	t.Helper()
	head := make([]byte, len(oleIdentifier))
	fh, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	if _, err := fh.Read(head); err != nil {
		t.Fatalf("read header: %v", err)
	}
	return head
}

func readA1(t *testing.T, info *FileInfo) string {
	t.Helper()
	f, err := excelize.OpenFile(info.Path, excelize.Options{Password: "s3cret"})
	if err != nil {
		t.Fatalf("open %s with password: %v", info.Path, err)
	}
	defer f.Close()
	value, err := f.GetCellValue(info.Sheets[0].ID, "A1")
	if err != nil {
		t.Fatalf("read A1: %v", err)
	}
	return value
}

func isOLEHeader(head []byte) bool {
	if len(head) != len(oleIdentifier) {
		return false
	}
	for i, b := range oleIdentifier {
		if head[i] != b {
			return false
		}
	}
	return true
}
