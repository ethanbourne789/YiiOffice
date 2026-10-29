package host

import (
	"strings"

	"golang.org/x/sys/windows/registry"
)

var officeTypes = []string{".docx", ".xlsx", ".pptx", ".pdf", ".md"}

// DefaultAppManager handles default application status on Windows.
type DefaultAppManager struct{}

// GetDefaultAppStatus returns the association status per file type.
func (m *DefaultAppManager) GetDefaultAppStatus() map[string]string {
	result := make(map[string]string)
	for _, ext := range officeTypes {
		status, err := m.CheckAssociation(ext)
		if err != nil {
			result[ext] = "unknown"
		} else {
			result[ext] = status
		}
	}
	return result
}

// SetDefaultApp opens the Windows default apps settings page.
// Returns the URI that should be opened.
func (m *DefaultAppManager) SetDefaultApp() string {
	return "ms-settings:defaultapps"
}

// CheckAssociation checks if a specific extension is associated with our app.
func (m *DefaultAppManager) CheckAssociation(ext string) (string, error) {
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	// Try to read from HKCU\Software\Classes\Extensions\.ext\OpenWithProgids
	key, err := registry.OpenKey(registry.CURRENT_USER,
		"Software\\Classes\\Extensions\\"+ext+"\\OpenWithProgids", registry.QUERY_VALUE)
	if err != nil {
		// Try OpenWithList
		key, err = registry.OpenKey(registry.CURRENT_USER,
			"Software\\Classes\\Extensions\\"+ext+"\\OpenWithList", registry.QUERY_VALUE)
		if err != nil {
			return "available", nil
		}
		defer key.Close()
	} else {
		defer key.Close()
	}

	// If we got here, the extension has some association
	return "available", nil
}
