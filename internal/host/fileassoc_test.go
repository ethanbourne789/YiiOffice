package host

import (
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestGetDefaultAppStatus(t *testing.T) {
	m := &DefaultAppManager{}
	status := m.GetDefaultAppStatus()

	// Should return all office types
	if len(status) != len(officeTypes) {
		t.Errorf("expected %d types, got %d", len(officeTypes), len(status))
	}

	// All expected extensions should be present
	for _, ext := range officeTypes {
		if _, ok := status[ext]; !ok {
			t.Errorf("missing extension %s in status", ext)
		}
	}
}

func TestSetDefaultApp(t *testing.T) {
	m := &DefaultAppManager{}
	uri := m.SetDefaultApp()

	expected := "ms-settings:defaultapps"
	if uri != expected {
		t.Errorf("SetDefaultApp() = %q, want %q", uri, expected)
	}
}

func TestCheckAssociation(t *testing.T) {
	m := &DefaultAppManager{}

	tests := []struct {
		name   string
		input  string
		prefix string // expected to start with "."
	}{
		{"with dot", ".docx", "."},
		{"without dot", "docx", "."},
		{"mixed case", ".XLSX", "."},
		{"pdf", "pdf", "."},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			status, err := m.CheckAssociation(tc.input)
			if err != nil {
				t.Errorf("CheckAssociation(%q) error: %v", tc.input, err)
			}
			// Status should be one of the valid values
			if status != "associated" && status != "available" && status != "unknown" {
				t.Errorf("CheckAssociation(%q) returned invalid status %q, expected one of: associated, available, unknown", tc.input, status)
			}
		})
	}
}

func TestCheckAssociationNormalizesExtension(t *testing.T) {
	m := &DefaultAppManager{}

	// Both forms should produce the same result
	status1, _ := m.CheckAssociation(".docx")
	status2, _ := m.CheckAssociation("docx")

	if status1 != status2 {
		t.Errorf("CheckAssociation(.docx) = %q, CheckAssociation(docx) = %q; should be equal", status1, status2)
	}
}

func TestCheckAssociationStatusValues(t *testing.T) {
	m := &DefaultAppManager{}

	// Verify that status values are among the expected set
	for _, ext := range officeTypes {
		status, err := m.CheckAssociation(ext)
		if err != nil {
			t.Errorf("CheckAssociation(%q) unexpected error: %v", ext, err)
			continue
		}
		switch status {
		case "associated", "available":
			// Both are valid
		default:
			t.Errorf("CheckAssociation(%q) returned unexpected status %q", ext, status)
		}
	}
}

// TestRegisterAssociationsWritesProgid writes into a throwaway tree under HKCU
// and removes it afterwards, so the real Software\Classes entries stay intact.
func TestRegisterAssociationsWritesProgid(t *testing.T) {
	root := "Software\\YiiOfficeTest-" + t.Name()
	t.Cleanup(func() {
		for _, ext := range officeTypes {
			registry.DeleteKey(registry.CURRENT_USER, root+"\\"+ProgID(ext)+"\\shell\\open\\command")
			registry.DeleteKey(registry.CURRENT_USER, root+"\\"+ProgID(ext)+"\\shell\\open")
			registry.DeleteKey(registry.CURRENT_USER, root+"\\"+ProgID(ext)+"\\shell")
			registry.DeleteKey(registry.CURRENT_USER, root+"\\"+ProgID(ext))
			registry.DeleteKey(registry.CURRENT_USER, root+"\\"+ext+"\\OpenWithProgids")
			registry.DeleteKey(registry.CURRENT_USER, root+"\\"+ext)
		}
		registry.DeleteKey(registry.CURRENT_USER, root)
	})

	exe := filepath.Join(t.TempDir(), "yiioffice.exe")
	if err := registerAssociationsFor(root, exe); err != nil {
		t.Fatalf("registerAssociationsFor: %v", err)
	}

	key, err := registry.OpenKey(registry.CURRENT_USER, root+"\\"+ProgID(".docx")+"\\shell\\open\\command", registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open command key: %v", err)
	}
	defer key.Close()
	command, _, err := key.GetStringValue("")
	if err != nil {
		t.Fatalf("read command: %v", err)
	}
	want := `"` + exe + `" "%1"`
	if command != want {
		t.Errorf("command = %q, want %q", command, want)
	}

	list, err := registry.OpenKey(registry.CURRENT_USER, root+"\\.docx\\OpenWithProgids", registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open-with key: %v", err)
	}
	defer list.Close()
	if _, _, err := list.GetStringValue(ProgID(".docx")); err != nil {
		t.Errorf("OpenWithProgids missing %s: %v", ProgID(".docx"), err)
	}
}

func TestRegisterAssociationsRejectsEmptyExe(t *testing.T) {
	if err := registerAssociationsFor("Software\\YiiOfficeTest-noexe", ""); err == nil {
		t.Fatal("expected an error for an empty executable path")
	}
}
