//go:build windows

package host

import (
	"os"
	"path/filepath"
)

// userDataEnvVar overrides the application data directory. It exists for the
// E2E harness (and for portable/QA runs): the server build used by the E2E
// suite must never read or write the real %APPDATA%\YiiOffice, otherwise a test
// run would pollute the developer's recents, starred list and settings. The
// name matches the contract the Electron shell exposed to its Playwright suite.
const userDataEnvVar = "YIIOFFICE_USER_DATA"

// AppDataDir returns %APPDATA%\YiiOffice, creating it when missing.
// When YIIOFFICE_USER_DATA is set to an absolute path, that directory is used
// instead and nothing outside it is touched.
func AppDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "YiiOffice")
	if override := os.Getenv(userDataEnvVar); override != "" {
		if !filepath.IsAbs(override) {
			// A relative override would resolve against the (unpredictable)
			// working directory of the launched binary.
			return "", &os.PathError{Op: "user data dir", Path: override, Err: os.ErrInvalid}
		}
		dir = filepath.Clean(override)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
