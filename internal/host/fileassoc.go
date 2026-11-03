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
	for _, ext := range officeTypes {
		if err := registerOneFor(root, ext, exePath); err != nil {
			return err
		}
	}
	return nil
}

// registerOneFor writes the ProgID, its open command and the extension's
// OpenWithProgids entry for a single extension under root. Re-running it with
// a different exePath refreshes the stored command (install moved/upgraded).
func registerOneFor(root, ext, exePath string) error {
	if exePath == "" {
		return fmt.Errorf("missing executable path")
	}
	ext = NormalizeExt(ext)
	command := fmt.Sprintf("\"%s\" \"%%1\"", exePath)
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
	return nil
}

// RegisterExtension associates one extension (e.g. ".docx") with YiiOffice for
// the current user: ProgID + open command + an entry in the extension's
// OpenWithProgids list, so Explorer's "Open with" offers YiiOffice. Calling it
// again refreshes the stored executable path.
func RegisterExtension(ext, exePath string) error {
	return registerOneFor("Software\\Classes", ext, exePath)
}

// UnregisterExtension removes only what YiiOffice wrote for ext: its ProgID
// subtree and its value in the OpenWithProgids list. Foreign values and the
// extension key itself are left alone, and re-running on an already-clean
// extension succeeds (idempotent).
func UnregisterExtension(ext string) error {
	return unregisterExtensionFor("Software\\Classes", ext)
}

// deleteTree recursively removes a key and its subkeys. The pinned x/sys
// registry package has no DeleteTree helper; DeleteKey only removes empty keys.
func deleteTree(path string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.READ)
	if err != nil {
		if err == registry.ErrNotExist {
			return nil
		}
		return err
	}
	names, err := key.ReadSubKeyNames(-1)
	key.Close()
	if err != nil {
		return err
	}
	for _, name := range names {
		if err := deleteTree(path + "\\" + name); err != nil {
			return err
		}
	}
	if err := registry.DeleteKey(registry.CURRENT_USER, path); err != nil && err != registry.ErrNotExist {
		return err
	}
	return nil
}

func unregisterExtensionFor(root, ext string) error {
	ext = NormalizeExt(ext)
	progID := ProgID(ext)
	if err := deleteTree(root + "\\" + progID); err != nil {
		return fmt.Errorf("delete progid %s: %w", progID, err)
	}
	extKey, err := registry.OpenKey(registry.CURRENT_USER, root+"\\"+ext+"\\OpenWithProgids", registry.SET_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return nil
		}
		return fmt.Errorf("open open-with list %s: %w", ext, err)
	}
	defer extKey.Close()
	if err := extKey.DeleteValue(progID); err != nil && err != registry.ErrNotExist {
		return fmt.Errorf("delete open-with value %s: %w", progID, err)
	}
	return nil
}

// extensionRegisteredFor reports whether the YiiOffice ProgID for ext is still
// listed in the extension's OpenWithProgids under root.
func extensionRegisteredFor(root, ext string) bool {
	ext = NormalizeExt(ext)
	key, err := registry.OpenKey(registry.CURRENT_USER, root+"\\"+ext+"\\OpenWithProgids", registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()
	names, err := key.ReadValueNames(-1)
	if err != nil {
		return false
	}
	for _, name := range names {
		if strings.EqualFold(name, ProgID(ext)) {
			return true
		}
	}
	return false
}

const (
	appName             = "YiiOffice"
	capabilitiesAppRoot = "Software\\YiiOffice"
	registeredAppsRoot  = "Software\\RegisteredApplications"
	// fileExtsRoot holds the per-user UserChoice entries; Windows protects
	// them with a hash, so YiiOffice only ever reads them.
	fileExtsRoot = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts"
)

// registerCapabilitiesFor lists the app under Capabilities and
// RegisteredApplications so Settings → Default Apps offers YiiOffice.
func registerCapabilitiesFor(appRoot, regAppsRoot, exePath string) error {
	if exePath == "" {
		return fmt.Errorf("missing executable path")
	}
	capPath := appRoot + "\\Capabilities"
	capKey, _, err := registry.CreateKey(registry.CURRENT_USER, capPath, registry.ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("create capabilities: %w", err)
	}
	werr := capKey.SetStringValue("ApplicationName", appName)
	if werr == nil {
		werr = capKey.SetStringValue("ApplicationDescription", "YiiOffice document suite")
	}
	if werr == nil {
		werr = capKey.SetStringValue("ApplicationIcon", exePath+",0")
	}
	capKey.Close()
	if werr != nil {
		return fmt.Errorf("write capabilities: %w", werr)
	}

	faKey, _, err := registry.CreateKey(registry.CURRENT_USER, capPath+"\\FileAssociations", registry.ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("create file associations: %w", err)
	}
	ferr := error(nil)
	for _, ext := range officeTypes {
		if ferr = faKey.SetStringValue(ProgID(ext), ext); ferr != nil {
			break
		}
	}
	faKey.Close()
	if ferr != nil {
		return fmt.Errorf("write file associations: %w", ferr)
	}

	raKey, _, err := registry.CreateKey(registry.CURRENT_USER, regAppsRoot, registry.ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("open registered applications: %w", err)
	}
	rerr := raKey.SetStringValue(appName, capPath)
	raKey.Close()
	if rerr != nil {
		return fmt.Errorf("write registered applications: %w", rerr)
	}
	return nil
}

// unregisterCapabilitiesFor removes the Capabilities registration written by
// registerCapabilitiesFor (idempotent).
func unregisterCapabilitiesFor(appRoot, regAppsRoot string) error {
	if err := deleteTree(appRoot + "\\Capabilities"); err != nil {
		return fmt.Errorf("delete capabilities: %w", err)
	}
	raKey, err := registry.OpenKey(registry.CURRENT_USER, regAppsRoot, registry.SET_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return nil
		}
		return fmt.Errorf("open registered applications: %w", err)
	}
	defer raKey.Close()
	if err := raKey.DeleteValue(appName); err != nil && err != registry.ErrNotExist {
		return fmt.Errorf("delete registered applications entry: %w", err)
	}
	return nil
}

// RegisterCapabilities makes YiiOffice visible to the Windows default-apps
// picker for the current user (HKCU only, no UAC).
func RegisterCapabilities(exePath string) error {
	return registerCapabilitiesFor(capabilitiesAppRoot, registeredAppsRoot, exePath)
}

// UnregisterCapabilities removes what RegisterCapabilities wrote (idempotent).
func UnregisterCapabilities() error {
	return unregisterCapabilitiesFor(capabilitiesAppRoot, registeredAppsRoot)
}

// readUserChoiceFor returns the ProgId the user picked for ext, or "" when no
// explicit choice exists. Read-only: the UserChoice key carries a hash Windows
// validates, so no program may write it on the user's behalf.
func readUserChoiceFor(root, ext string) string {
	key, err := registry.OpenKey(registry.CURRENT_USER, root+"\\"+NormalizeExt(ext)+"\\UserChoice", registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer key.Close()
	progID, _, err := key.GetStringValue("ProgId")
	if err != nil {
		return ""
	}
	return progID
}

func NormalizeExt(ext string) string {
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return ext
}

// FileAssocEntry is the reconciled association state of one extension, read
// live from the registry so the UI never shows a stale switch.
type FileAssocEntry struct {
	Ext        string `json:"ext"`
	Registered bool   `json:"registered"`
	IsDefault  bool   `json:"isDefault"`
	DefaultApp string `json:"defaultApp"`
}

// GetFileAssocStatus reports, per supported extension, whether YiiOffice is
// registered in "Open with" and whether the user chose it as the default.
func (m *DefaultAppManager) GetFileAssocStatus() []FileAssocEntry {
	out := make([]FileAssocEntry, 0, len(officeTypes))
	for _, ext := range officeTypes {
		defaultProgID := readUserChoiceFor(fileExtsRoot, ext)
		out = append(out, FileAssocEntry{
			Ext:        ext,
			Registered: extensionRegisteredFor("Software\\Classes", ext),
			IsDefault:  strings.EqualFold(defaultProgID, ProgID(ext)),
			DefaultApp: defaultProgID,
		})
	}
	return out
}

// SetExtensionAssoc enables or disables the association for one extension.
// Enabling registers the ProgID and refreshes the Capabilities entry; the
// default-program choice itself stays with the user (Windows UserChoice).
func SetExtensionAssoc(ext, exePath string, enabled bool) error {
	ext = NormalizeExt(ext)
	if enabled {
		if err := RegisterExtension(ext, exePath); err != nil {
			return err
		}
		return RegisterCapabilities(exePath)
	}
	if err := UnregisterExtension(ext); err != nil {
		return err
	}
	for _, other := range officeTypes {
		if other != ext && extensionRegisteredFor("Software\\Classes", other) {
			return nil
		}
	}
	return UnregisterCapabilities()
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
