package host

import (
	"strings"

	"golang.org/x/sys/windows/registry"
)

var officeTypes = []string{".docx", ".xlsx", ".pptx", ".pdf", ".md"}

// DefaultAppManager handles default application status on Windows.
type DefaultAppManager struct{}

// GetDefaultAppStatus returns the association status per file type.
// Status values: "associated" (YiiOffice is default), "available" (not default), "unknown" (error)
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
func (m *DefaultAppManager) SetDefaultApp() string {
	return "ms-settings:defaultapps"
}

// CheckAssociation checks if a specific extension is associated with YiiOffice.
// Returns "associated" if YiiOffice is the handler, "available" otherwise.
func (m *DefaultAppManager) CheckAssociation(ext string) (string, error) {
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	// Check Windows 10+ Extensions registry path
	key, err := registry.OpenKey(registry.CURRENT_USER,
		"Software\\Classes\\Extensions\\"+ext+"\\OpenWithProgids", registry.QUERY_VALUE)
	if err != nil {
		// Fallback: check if the extension has an OpenWithList
		_, err2 := registry.OpenKey(registry.CURRENT_USER,
			"Software\\Classes\\Extensions\\"+ext+"\\OpenWithList", registry.QUERY_VALUE)
		if err2 != nil {
			// No association data found
			return "available", nil
		}
		return "available", nil
	}
	defer key.Close()

	// Check if YiiOffice.* progid is in the list
	names, _, err := key.GetStringsValue("")
	if err == nil {
		for _, name := range names {
			if strings.HasPrefix(strings.ToLower(name), "yiioffice.") {
				return "associated", nil
			}
		}
	}

	return "available", nil
}
