//go:build windows

package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"runtime/debug"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"gitee.com/ethanbourne789/yiioffice/internal/assets"
	"gitee.com/ethanbourne789/yiioffice/internal/bridge"
	"gitee.com/ethanbourne789/yiioffice/internal/buildinfo"
	"gitee.com/ethanbourne789/yiioffice/internal/diagnose"
	"gitee.com/ethanbourne789/yiioffice/internal/export"
	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/index"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
	"gitee.com/ethanbourne789/yiioffice/internal/update"
	"gitee.com/ethanbourne789/yiioffice/internal/workbook"
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

	rm := host.NewRecentManager(dataDir)
	fm := host.NewFolderManager(dataDir, func() string { return store.Snapshot().DefaultSaveDir })
	tabHost := host.NewTabHost()
	detachedHost := host.NewDetachedHost()
	fo := &host.FileOps{}
	openFileFn := func() ([]string, error) {
		app := platform.App()
		if app == nil {
			return nil, nil
		}
		files, err := app.Dialog.OpenFile().
			SetTitle("Open File").
			PromptForMultipleSelection()
		return files, err
	}
	dam := &host.DefaultAppManager{}

	// Window close guard (unsaved document protection). The editors report
	// dirtiness through TabService.SetDirty; GetDirty converts the host view
	// into the guard's own type and resets the per-attempt user decision.
	var quitConfirmed *bool
	closeGuard := host.NewCloseGuard(tabHost, &host.CloseGuardConfig{
		GetDirty: func() []host.DirtyTab {
			quitConfirmed = nil
			summaries := tabHost.DirtyTabs()
			out := make([]host.DirtyTab, 0, len(summaries))
			for _, s := range summaries {
				out = append(out, host.DirtyTab{ID: s.ID, Title: s.Title, Kind: s.Kind})
			}
			return out
		},
		PromptSave: func(tab host.DirtyTab) host.SaveChoice {
			if quitConfirmed == nil {
				titles := make([]string, 0, 4)
				for _, s := range tabHost.DirtyTabs() {
					titles = append(titles, s.Title)
				}
				answer := platform.ConfirmDiscardChanges(titles)
				quitConfirmed = &answer
			}
			if !*quitConfirmed {
				return host.Cancel
			}
			return host.DontSave
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

	// Initialize file index (non-fatal if it fails). Done before application.New
	// so the HomeService bindings can receive the lifecycle pointer.
	rootPaths := fm.RootPaths()
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

	// The Sheets editor runs on the in-process pure-Go workbook engine
	// (excelize); there is no external sidecar process.
	wbEngine := workbook.NewEngine()
	defer wbEngine.CloseAll()

	homeSvc := bridge.NewHomeService(
		buildinfo.Version, store, rm, fm, tabHost, fo, dam, idxLifecycle, openFileFn,
		platform.RevealPath,
	)

	app := application.New(application.Options{
		Name:        "YiiOffice",
		Description: "YiiOffice desktop office suite",
		Assets: application.AssetOptions{
			Handler: assets.New(dist),
		},
		Services: []application.Service{
			application.NewService(bridge.NewShellService(func(u string) error {
				return platform.OpenExternal(u)
			})),
			application.NewService(bridge.NewTabService(tabHost, detachedHost)),
			application.NewService(homeSvc),
			application.NewService(bridge.NewDocsService(rm, idxLifecycle)),
			application.NewService(bridge.NewSlidesService(rm)),
			application.NewService(bridge.NewPdfService(rm)),
			application.NewService(bridge.NewMarkdownService(rm)),
			application.NewService(bridge.NewWorkbookService(wbEngine, rm)),
			application.NewService(bridge.NewExportService()),
			application.NewService(&bridge.DiagService{}),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "gitee.com.ethanbourne789.yiioffice",
			// A file opened from Explorer while YiiOffice runs is handed to the
			// running instance instead of starting a second window.
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				openFilesFromArgs(homeSvc, data.Args)
			},
		},
		ShouldQuit: func() bool {
			return closeGuard.ShouldAllowClose()
		},
	})
	platform.Set(app)

	// The updater needs the application's host adapter, so it is configured
	// after application.New and registered as a service for the shell.
	updateSvc, err := update.New(app, buildinfo.Version)
	if err != nil {
		log.Printf("[shell] updater disabled: %v", err)
	} else {
		app.RegisterService(application.NewService(updateSvc))
	}

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:          "YiiOffice " + buildinfo.Version,
		Width:          1280,
		Height:         800,
		URL:            "/",
		Frameless:      true,
		StartState:     application.WindowStateMaximised,
		EnableFileDrop: true,
	})

	installSystemTray(app, win, closeGuard)

	if os.Getenv("YII_DIAG") != "" {
		installDiagProbe(win)
	}

	// Files passed on the command line (file association or a second launch
	// before the running instance existed).
	openFilesFromArgs(homeSvc, os.Args[1:])

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// installDiagProbe runs a one-shot script inside the shell renderer and reports
// its findings through the temporary DiagService. TEMPORARY: remove together
// with internal/bridge/diag_tmp.go.
func installDiagProbe(win *application.WebviewWindow) {
	const probe = `
(async () => {
  const LOGID = 437220436
  const send = (m) => { try { window.wails.Call.ByID(LOGID, String(m)) } catch (e) {} }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  window.addEventListener('error', (e) => send('top error: ' + e.message))
  window.addEventListener('unhandledrejection', (e) => send('top rejection: ' + String(e.reason)))
  try {
    let cards = []
    for (let i = 0; i < 60; i++) {
      cards = Array.from(document.querySelectorAll('.quick-card'))
      if (cards.length) break
      await wait(250)
    }
    send('cards=' + cards.map((c) => c.textContent).join('|'))
    for (let i = 0; i < cards.length; i++) {
      const all = Array.from(document.querySelectorAll('.quick-card'))
      if (!all[i]) { send('card ' + i + ' gone'); continue }
      send('>>> click card ' + i + ' ' + all[i].textContent)
      all[i].click()
      await wait(5000)
      const frames = Array.from(document.querySelectorAll('iframe'))
      const last = frames[frames.length - 1]
      if (!last) { send('  no iframe'); continue }
      try {
        const d = last.contentDocument
        const root = d && d.querySelector('#root')
        send('  src=' + last.getAttribute('src') + ' title=' + (d && d.title) + ' rootChildren=' + (root ? root.children.length : 'no-root') + ' text=' + JSON.stringify((d && d.body ? d.body.innerText : '').slice(0, 160)))
      } catch (e) { send('  inspect error ' + String(e)) }
    }
    send('tabs=' + JSON.stringify(Array.from(document.querySelectorAll('.tab-item')).map((t) => t.textContent)))
  } catch (e) {
    send('PROBE ERROR ' + String(e))
  }
})()
`
	win.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		win.ExecJS(probe)
	})
}

//go:embed build/windows/icon.ico
var trayIcon []byte

// installSystemTray adds the notification-area icon: left click toggles the
// main window, the menu offers Show/Hide and Quit.
func installSystemTray(app *application.App, win *application.WebviewWindow, guard *host.CloseGuard) {
	tray := app.SystemTray.New()
	tray.SetIcon(trayIcon)
	tray.SetTooltip("YiiOffice")
	tray.OnClick(func() {
		if win.IsVisible() {
			win.Hide()
			return
		}
		win.Show()
		win.Focus()
	})

	menu := app.NewMenu()
	menu.Add("Show YiiOffice").OnClick(func(_ *application.Context) {
		win.Show()
		win.Focus()
	})
	menu.Add("Hide YiiOffice").OnClick(func(_ *application.Context) {
		win.Hide()
	})
	menu.AddSeparator()
	menu.Add("Quit").OnClick(func(_ *application.Context) {
		if guard != nil && !guard.ShouldAllowClose() {
			return
		}
		app.Quit()
	})
	tray.SetMenu(menu)
}

// openFilesFromArgs opens every supported document path found in args;
// flags and unknown extensions are skipped.
func openFilesFromArgs(home *bridge.HomeService, args []string) {
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			continue
		}
		if _, ok := host.RouteByExt(arg); !ok {
			continue
		}
		if err := home.OpenPath(arg); err != nil {
			log.Printf("[shell] open %s: %v", arg, err)
		}
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
