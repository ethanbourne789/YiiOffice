package host

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"
)

var officeTypes = []string{".docx", ".xlsx", ".pptx", ".pdf", ".md"}

// ProgID returns the per-extension programmatic identifier YiiOffice registers,
// e.g. ".docx" -> "YiiOffice.docx".
func ProgID(ext string) string {
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return "YiiOffice" + ext
}

// RegisterAssociations writes per-user ProgIDs for every supported office
// extension and lists them in the extensions' OpenWithProgids, so Explorer's
// "Open with" offers YiiOffice. Only HKCU is touched; the user still has to
// choose YiiOffice as the default in Windows settings.
func RegisterAssociations(exePath string) error {
	return registerAssociationsFor("Software\\Classes", exePath)
}

// registerAssociationsFor writes the associations under root, which the test
// points at a throwaway key.
func registerAssociationsFor(root, exePath string) error {
	if exePath == "" {
		return fmt.Errorf("missing executable path")
	}
	command := fmt.Sprintf("\"%s\" \"%%1\"", exePath)
	for _, ext := range officeTypes {
		progID := ProgID(ext)
		progKey, _, err := registry.CreateKey(registry.CURRENT_USER, root+"\\"+progID, registry.ALL_ACCESS)
		if err != nil {
			return fmt.Errorf("create progid %s: %w", progID, err)
		}
		werr := progKey.SetStringValue("", "YiiOffice Document")
		if werr == nil {
			werr = progKey.SetStringValue("FriendlyTypeName", "YiiOffice Document")
		}
		progKey.Close()
		if werr != nil {
			return fmt.Errorf("write progid %s: %w", progID, werr)
		}

		cmdKey, _, err := registry.CreateKey(registry.CURRENT_USER, root+"\\"+progID+"\\shell\\open\\command", registry.ALL_ACCESS)
		if err != nil {
			return fmt.Errorf("create open command %s: %w", progID, err)
		}
		cerr := cmdKey.SetStringValue("", command)
		cmdKey.Close()
		if cerr != nil {
			return fmt.Errorf("write open command %s: %w", progID, cerr)
		}

		extKey, _, err := registry.CreateKey(registry.CURRENT_USER, root+"\\"+ext+"\\OpenWithProgids", registry.ALL_ACCESS)
		if err != nil {
			return fmt.Errorf("create open-with list %s: %w", ext, err)
		}
		verr := extKey.SetStringValue(progID, "")
		extKey.Close()
		if verr != nil {
			return fmt.Errorf("write open-with list %s: %w", ext, verr)
		}
	}
	return nil
}

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

	// RegisterAssociations writes Software\Classes\.ext\OpenWithProgids; older
	// installs used the legacy Extensions key, so both are probed.
	for _, path := range []string{
		"Software\\Classes\\" + ext + "\\OpenWithProgids",
		"Software\\Classes\\Extensions\\" + ext + "\\OpenWithProgids",
	} {
		key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		names, nerr := key.ReadValueNames(-1)
		key.Close()
		if nerr != nil {
			continue
		}
		for _, name := range names {
			if strings.HasPrefix(strings.ToLower(name), "yiioffice.") {
				return "associated", nil
			}
		}
	}

	return "available", nil
}
