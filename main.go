//go:build windows

package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"path/filepath"
	"context"
	"os"
	"os/exec"
	"runtime/debug"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"gitee.com/ethanbourne789/yiioffice/internal/assets"
	"gitee.com/ethanbourne789/yiioffice/internal/bridge"
	"gitee.com/ethanbourne789/yiioffice/internal/buildinfo"
	"gitee.com/ethanbourne789/yiioffice/internal/diagnose"
	"gitee.com/ethanbourne789/yiioffice/internal/export"
	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
	"gitee.com/ethanbourne789/yiioffice/internal/update"
	"gitee.com/ethanbourne789/yiioffice/internal/sidecar"
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

	// Check for --headless-export flag BEFORE any GUI initialization.
	if req, ok := export.ShouldRunHeadless(); ok {
		code := runHeadlessExport(req)
		os.Exit(code)
	}

	if err := platform.RequireWindows(); err != nil {
		log.Fatal(err)
	}

	if err := platform.CheckWebView2(); err != nil {
		log.Printf("warning: %v", err)
		log.Println("WebView2 is required to run YiiOffice.")
		log.Println("Please install WebView2 from: https://go.microsoft.com/fwlink/p/?LinkId=2124703")
		exec.Command("cmd", "/c", "start", platform.WebView2InstallURL()).Start()
		os.Exit(1)
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

	ub := update.NewBridge(update.New(buildinfo.Version,
		"https://gitee.com/ethanbourne789/yiioffice/releases/latest"))
	bridge.RegisterUpdate(router, ub)

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
		ShouldQuit: func() bool {
			return closeGuard.ShouldAllowClose()
		},
	})
	platform.Set(app)

	// Initialize file index (non-fatal if it fails)
	rootPaths := make([]string, 0, len(fm.GetRoots()))
	for _, r := range fm.GetRoots() {
		rootPaths = append(rootPaths, r.Path)
	}
	var idxLifecycle *index.Lifecycle
	if lc, err := index.Init(dataDir, rootPaths); err != nil {
		log.Printf("warning: file index init failed: %v", err)
	} else {
		idxLifecycle = lc
		defer func() {
			if err := idxLifecycle.Shutdown(); err != nil {
				log.Printf("warning: file index shutdown error: %v", err)
			}
		}()
	}

	// Register editor channels
	bridge.RegisterEditorCommon(router, store)
	bridge.RegisterSearch(router, idxLifecycle, rm)
	bridge.RegisterDocs(router, rm, idxLifecycle)

	// Initialize xlsx sidecar (non-fatal if binary is missing)
	sidecarDir := filepath.Join(dataDir, "native")
	var xlsxMgr *sidecar.XlsxManager
	if sm, err := sidecar.NewXlsxManager(sidecarDir); err != nil {
		log.Printf("info: xlsx sidecar not available: %v (sheets will use stub mode)", err)
	} else {
		xlsxMgr = sm
		defer xlsxMgr.Stop()
	}

	bridge.RegisterSheets(router, xlsxMgr)
	bridge.RegisterSlides(router, rm)
	bridge.RegisterPdf(router, rm)
	bridge.RegisterMarkdown(router, rm)

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

// runHeadlessExport executes a headless document export and returns the exit code.
func runHeadlessExport(req export.HeadlessRequest) int {
	// Build the exporter map.
	exporters := map[string]export.HeadlessExporter{
		export.ModuleDocs:     export.ExportDocsHeadless,
		export.ModuleSheets:   export.ExportSheetsPdfHeadless,
		export.ModuleSlides:   export.ExportSlidesPdfHeadless,
		export.ModuleMarkdown: export.ExportMarkdownPdfHeadless,
	}

	outcome := export.RunHeadlessExport(req, exporters)

	// Format and print the result envelope.
	envelope := export.FormatHeadlessEnvelope(outcome, req.JSON)
	fmt.Println(envelope)

	// Flush stdout before exit (up to 2 seconds).
	time.Sleep(100 * time.Millisecond)

	return export.HeadlessExitCode(outcome)
}
