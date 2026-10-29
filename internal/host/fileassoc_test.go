package host

import "testing"

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
			// Status should be a valid string (not empty)
			if status == "" {
				t.Errorf("CheckAssociation(%q) returned empty status", tc.input)
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
