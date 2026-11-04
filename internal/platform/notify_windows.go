//go:build windows

package platform

import (
	"encoding/xml"
	"fmt"
	"os"
	"sync"

	wintoast "git.sr.ht/~jackmordaunt/go-toast/v2/wintoast"
)

// notificationGUID identifies YiiOffice's in-process toast activator. It is
// fixed (rather than generated and stored in the registry) so the activation
// registration always points at the same CLSID across installs and upgrades.
const notificationGUID = "{6F1A9C24-0B2E-4C5D-8E7A-3D9B1F2C4A68}"

var (
	toastInitOnce sync.Once
	toastInitErr  error
)

type toastText struct {
	Value string `xml:",chardata"`
}

type toastBinding struct {
	Template string      `xml:"template,attr"`
	Texts    []toastText `xml:"text"`
}

type toastVisual struct {
	Binding toastBinding `xml:"binding"`
}

type toastDoc struct {
	XMLName xml.Name    `xml:"toast"`
	Visual  toastVisual `xml:"visual"`
}

// initToast registers YiiOffice's AppUserModelID and toast activator with the
// Windows Runtime once. It only writes HKCU keys, so it never needs elevation;
// a failure is reported to the caller instead of blocking anything.
func initToast() error {
	toastInitOnce.Do(func() {
		exe, err := os.Executable()
		if err != nil {
			toastInitErr = fmt.Errorf("resolve executable: %w", err)
			return
		}
		toastInitErr = wintoast.SetAppData(wintoast.AppData{
			AppID:         AppUserModelID,
			GUID:          notificationGUID,
			ActivationExe: exe,
		})
		if toastInitErr != nil {
			toastInitErr = fmt.Errorf("register toast app data: %w", toastInitErr)
		}
	})
	return toastInitErr
}

// ShowNotification raises a Windows toast with the given title and body. It
// must run on the UI thread: the WinRT toast APIs are initialized as STA there.
// Errors are returned rather than logged so the caller decides what to do.
func ShowNotification(title, body string) error {
	if title == "" {
		title = "YiiOffice"
	}
	if err := initToast(); err != nil {
		return err
	}
	doc := toastDoc{
		Visual: toastVisual{
			Binding: toastBinding{
				Template: "ToastGeneric",
				Texts:    []toastText{{Value: title}, {Value: body}},
			},
		},
	}
	data, err := xml.Marshal(doc)
	if err != nil {
		return fmt.Errorf("marshal toast xml: %w", err)
	}
	payload := xml.Header + string(data)
	err = wintoast.Push(AppUserModelID, payload)
	if err == nil {
		return nil
	}
	// go-toast initializes WinRT once per process and marks that attempt done
	// even when it fails (e.g. the UI thread already joined another COM
	// apartment). A second call therefore skips initialization and goes
	// straight to the toast APIs, which makes a single retry worthwhile.
	return wintoast.Push(AppUserModelID, payload)
}
