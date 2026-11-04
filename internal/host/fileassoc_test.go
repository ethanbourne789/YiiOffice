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

// throwawayRoot creates a per-test HKCU tree that is removed afterwards, so
// none of these tests touch the real Software\Classes entries.
func throwawayRoot(t *testing.T, name string) string {
	root := "Software\\YiiOfficeTest-" + name + "-" + t.Name()
	t.Cleanup(func() {
		if err := deleteTree(root); err != nil {
			t.Logf("cleanup %s: %v", root, err)
		}
	})
	return root
}

func TestRegisterUnregisterExtensionRoundtrip(t *testing.T) {
	root := throwawayRoot(t, "roundtrip")
	exe := filepath.Join(t.TempDir(), "yiioffice.exe")

	if err := registerOneFor(root, ".docx", exe); err != nil {
		t.Fatalf("registerOneFor: %v", err)
	}
	if !extensionRegisteredFor(root, ".docx") {
		t.Fatal("extension should be registered after registerOneFor")
	}

	// A foreign value in the same OpenWithProgids list must survive.
	extKey, _, err := registry.CreateKey(registry.CURRENT_USER, root+"\\.docx\\OpenWithProgids", registry.SET_VALUE)
	if err != nil {
		t.Fatalf("create foreign value: %v", err)
	}
	if err := extKey.SetStringValue("OtherProgID.Other", ""); err != nil {
		t.Fatalf("write foreign value: %v", err)
	}
	extKey.Close()

	if err := unregisterExtensionFor(root, ".docx"); err != nil {
		t.Fatalf("unregisterExtensionFor: %v", err)
	}
	if extensionRegisteredFor(root, ".docx") {
		t.Fatal("extension should be unregistered")
	}
	if _, err := registry.OpenKey(registry.CURRENT_USER, root+"\\"+ProgID(".docx"), registry.QUERY_VALUE); err != registry.ErrNotExist {
		t.Fatalf("progid subtree should be gone, got %v", err)
	}
	extKey, err = registry.OpenKey(registry.CURRENT_USER, root+"\\.docx\\OpenWithProgids", registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open-with list should remain: %v", err)
	}
	defer extKey.Close()
	if _, _, err := extKey.GetStringValue("OtherProgID.Other"); err != nil {
		t.Errorf("foreign value must not be deleted: %v", err)
	}
	if _, _, err := extKey.GetStringValue(ProgID(".docx")); err != registry.ErrNotExist {
		t.Errorf("own value should be gone, got %v", err)
	}
}

func TestUnregisterExtensionIsIdempotent(t *testing.T) {
	root := throwawayRoot(t, "idem")
	if err := unregisterExtensionFor(root, ".docx"); err != nil {
		t.Fatalf("unregister on a clean tree: %v", err)
	}
	exe := filepath.Join(t.TempDir(), "yiioffice.exe")
	if err := registerOneFor(root, ".docx", exe); err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := unregisterExtensionFor(root, ".docx"); err != nil {
		t.Fatalf("first unregister: %v", err)
	}
	if err := unregisterExtensionFor(root, ".docx"); err != nil {
		t.Fatalf("second unregister: %v", err)
	}
}

func TestRegisterExtensionRefreshesCommandPath(t *testing.T) {
	root := throwawayRoot(t, "refresh")
	oldExe := filepath.Join(t.TempDir(), "old", "yiioffice.exe")
	newExe := filepath.Join(t.TempDir(), "new", "yiioffice.exe")

	if err := registerOneFor(root, ".xlsx", oldExe); err != nil {
		t.Fatalf("register old: %v", err)
	}
	if err := registerOneFor(root, ".xlsx", newExe); err != nil {
		t.Fatalf("register new: %v", err)
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, root+"\\"+ProgID(".xlsx")+"\\shell\\open\\command", registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open command: %v", err)
	}
	defer key.Close()
	command, _, err := key.GetStringValue("")
	if err != nil {
		t.Fatalf("read command: %v", err)
	}
	if want := `"` + newExe + `" "%1"`; command != want {
		t.Errorf("command = %q, want %q", command, want)
	}
}

func TestRegisterExtensionAcceptsSpacesAndUnicode(t *testing.T) {
	root := throwawayRoot(t, "spaces")
	exe := `C:\Users\测试 用户\Program Files\Yii Office\yiioffice.exe`
	if err := registerOneFor(root, ".md", exe); err != nil {
		t.Fatalf("register: %v", err)
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, root+"\\"+ProgID(".md")+"\\shell\\open\\command", registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open command: %v", err)
	}
	defer key.Close()
	command, _, err := key.GetStringValue("")
	if err != nil {
		t.Fatalf("read command: %v", err)
	}
	if want := `"` + exe + `" "%1"`; command != want {
		t.Errorf("command = %q, want %q", command, want)
	}
}

func TestReadUserChoiceFor(t *testing.T) {
	root := throwawayRoot(t, "userchoice")
	if got := readUserChoiceFor(root, ".docx"); got != "" {
		t.Errorf("missing UserChoice should read as empty, got %q", got)
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, root+"\\.docx\\UserChoice", registry.SET_VALUE)
	if err != nil {
		t.Fatalf("create userchoice: %v", err)
	}
	if err := key.SetStringValue("ProgId", "SomeApp.docx.1"); err != nil {
		t.Fatalf("write progid: %v", err)
	}
	key.Close()
	if got := readUserChoiceFor(root, ".docx"); got != "SomeApp.docx.1" {
		t.Errorf("readUserChoiceFor = %q, want %q", got, "SomeApp.docx.1")
	}
}

func TestCapabilitiesRoundtrip(t *testing.T) {
	appRoot := throwawayRoot(t, "caps")
	regApps := appRoot + "\\RegisteredApplications"
	exe := filepath.Join(t.TempDir(), "yiioffice.exe")

	if err := registerCapabilitiesFor(appRoot, regApps, exe); err != nil {
		t.Fatalf("registerCapabilitiesFor: %v", err)
	}
	capKey, err := registry.OpenKey(registry.CURRENT_USER, appRoot+"\\Capabilities", registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open capabilities: %v", err)
	}
	if name, _, err := capKey.GetStringValue("ApplicationName"); err != nil || name != "YiiOffice" {
		t.Errorf("ApplicationName = %q (err %v)", name, err)
	}
	capKey.Close()
	faKey, err := registry.OpenKey(registry.CURRENT_USER, appRoot+"\\Capabilities\\FileAssociations", registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open file associations: %v", err)
	}
	if v, _, err := faKey.GetStringValue(".docx"); err != nil || v != ProgID(".docx") {
		t.Errorf("FileAssociations[.docx] = %q (err %v)", v, err)
	}
	faKey.Close()
	raKey, err := registry.OpenKey(registry.CURRENT_USER, regApps, registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("open registered applications: %v", err)
	}
	if v, _, err := raKey.GetStringValue("YiiOffice"); err != nil || v != appRoot+"\\Capabilities" {
		t.Errorf("RegisteredApplications entry = %q (err %v)", v, err)
	}
	raKey.Close()

	if err := unregisterCapabilitiesFor(appRoot, regApps); err != nil {
		t.Fatalf("unregisterCapabilitiesFor: %v", err)
	}
	if _, err := registry.OpenKey(registry.CURRENT_USER, appRoot+"\\Capabilities", registry.QUERY_VALUE); err != registry.ErrNotExist {
		t.Errorf("capabilities tree should be gone, got %v", err)
	}
	if err := unregisterCapabilitiesFor(appRoot, regApps); err != nil {
		t.Fatalf("second unregister should be idempotent: %v", err)
	}
}
