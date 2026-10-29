//go:build windows

package main

import (
	"embed"
	"io/fs"
	"log"
	"context"
	"runtime/debug"

	"github.com/wailsapp/wails/v3/pkg/application"

	"gitee.com/ethanbourne789/yiioffice/internal/assets"
	"gitee.com/ethanbourne789/yiioffice/internal/bridge"
	"gitee.com/ethanbourne789/yiioffice/internal/buildinfo"
	"gitee.com/ethanbourne789/yiioffice/internal/diagnose"
	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
	"gitee.com/ethanbourne789/yiioffice/internal/watchdog"
)

//go:embed all:frontend/dist
var embeddedAssets embed.FS

func main() {
	// Panic recovery with crash diagnostics
	defer func() {
		if r := recover(); r != nil {
			stack := debug.Stack()
			dataDir, _ := host.AppDataDir()
			if path, err := diagnose.WriteCrashReport(dataDir, r, stack); err == nil {
				log.Printf("[shell] crash report written to %s", path)
			}
			log.Fatalf("[shell] startup failed: %v", r)
		}
	}()

	if err := platform.RequireWindows(); err != nil {
		log.Fatal(err)
	}

	dist, err := fs.Sub(embeddedAssets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}

	dataDir, err := host.AppDataDir()
	if err != nil {
		log.Fatal(err)
	}
	store, err := host.NewSettingsStore(dataDir)
	if err != nil {
		log.Fatal(err)
	}

	router := bridge.NewRouter()
	bridge.RegisterHome(router, store, buildinfo.Version)
	rm := host.NewRecentManager(dataDir)
	bridge.RegisterRecent(router, rm)
	fm := host.NewFolderManager(dataDir)
	bridge.RegisterFolder(router, fm)
	tabHost := host.NewTabHost()
	bridge.RegisterTabs(router, tabHost, host.NewDetachedHost())
	fo := &host.FileOps{}
	bridge.RegisterFileOps(router, tabHost, fo, rm)
	bridge.RegisterOpenExternal(router, func(u string) error {
		return platform.OpenExternal(u)
	})
	bridge.RegisterDialogs(router, func() ([]string, error) {
		app := platform.App()
		if app == nil {
			return nil, nil
		}
		files, err := app.Dialog.OpenFile().
			SetTitle("Open File").
			PromptForMultipleSelection()
		return files, err
	}, platform.RevealPath)

	dam := &host.DefaultAppManager{}
	bridge.RegisterFileAssoc(router, dam)

	// Window close guard (unsaved document protection)
	closeGuard := host.NewCloseGuard(tabHost, &host.CloseGuardConfig{
		GetDirty: func() []host.DirtyTab {
			// Frontend will implement tabs:get-dirty-tabs via IPC.
			// For now, return empty (Phase 4+ will wire this up).
			return nil
		},
	})

	// Start renderer watchdog
	wd := watchdog.New(&watchdog.Config{
		DataDir: dataDir,
		OnHot: func(metric watchdog.ProcessMetric) {
			log.Printf("[watchdog] hot renderer: PID %d, CPU %.1f%%, Memory %.0fMB",
				metric.PID, metric.CPUPercent, metric.WorkingSetSizeMB)
		},
	})
	go wd.Start(context.Background())

	app := application.New(application.Options{
		Name:        "YiiOffice",
		Description: "YiiOffice desktop office suite",
		Assets: application.AssetOptions{
			Handler: assets.New(dist),
		},
		Services: []application.Service{
			application.NewService(bridge.NewService(router)),
		},
		SingleInstance: &application.SingleInstanceOptions{},
		OnBeforeClose: func() bool {
			return closeGuard.ShouldAllowClose()
		},
	})
	platform.Set(app)

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "YiiOffice " + buildinfo.Version,
		Width:  1280,
		Height: 800,
		URL:    "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
