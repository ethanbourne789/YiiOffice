//go:build windows

package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"os"
	"os/exec"
	"runtime/debug"
	"runtime/trace"
	"strings"
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
	"gitee.com/ethanbourne789/yiioffice/internal/servmode"
	"gitee.com/ethanbourne789/yiioffice/internal/update"
	"gitee.com/ethanbourne789/yiioffice/internal/workbook"
	"gitee.com/ethanbourne789/yiioffice/internal/watchdog"
)

//go:embed all:frontend/dist
var embeddedAssets embed.FS

// consoleLogger is the shared structured logger handed to the Wails runtime.
// In development mode the level is Debug so Wails bridge messages are visible;
// production builds raise it to Warn to keep the log concise.
var consoleLogLevel = slog.LevelWarn
var consoleLogger = func() *slog.Logger {
	if buildinfo.IsDev() {
		consoleLogLevel = slog.LevelDebug
	}
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: consoleLogLevel,
	}))
}()

func main() {
	// Cap the Go heap with a soft limit so large workbook sessions make the
	// GC work harder instead of competing with WebView2 renderer processes
	// for physical memory. 2 GiB is a conservative starting point; revisit
	// against field data before tuning per-device.
	debug.SetMemoryLimit(2 << 30)

	// --- Performance trace (dev-only, gated by WAILS_TRACE env var) ---
	if buildinfo.IsDev() {
		if os.Getenv("WAILS_TRACE") != "" {
			traceFile, err := os.Create("trace.out")
			if err == nil {
				trace.Start(traceFile)
				defer func() {
					trace.Stop()
					traceFile.Close()
					log.Println("trace written to trace.out — open with: go tool trace trace.out")
				}()
			}
		}
	}

	// Panic recovery with crash diagnostics (startup phase, before app exists)
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

	// Server builds (`-tags server`) run as an HTTP host with no webview, so the
	// WebView2 preflight is not only unnecessary but harmful: it would abort a
	// headless E2E/CI host on a machine without WebView2. Everything below that
	// touches windows, tray or native dialogs is a documented no-op there.
	if !servmode.Enabled {
		if err := platform.CheckWebView2(); err != nil {
			log.Printf("warning: %v", err)
			log.Println("WebView2 is required to run YiiOffice.")
			log.Println("Please install WebView2 from: https://go.microsoft.com/fwlink/p/?LinkId=2124703")
			exec.Command("cmd", "/c", "start", platform.WebView2InstallURL()).Start()
			os.Exit(1)
		}
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
		// Filter to the formats an editor can actually open; without it the
		// picker offered every file on disk and picking an unsupported one
		// failed silently (host.RouteByExt has nowhere to route it).
		files, err := app.Dialog.OpenFile().
			SetTitle("Open File").
			AddFilter("Office Documents", "*.docx;*.xlsx;*.xlsm;*.csv;*.tsv;*.pptx;*.pdf;*.md;*.markdown").
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

	// Start renderer watchdog with a cancellable context so InternalService
	// can stop it during ServiceShutdown.
	wdCtx, cancelWd := context.WithCancel(context.Background())
	wd := watchdog.New(&watchdog.Config{
		DataDir: dataDir,
		OnHot: func(metric watchdog.ProcessMetric) {
			platform.Logger().Warn("hot renderer detected",
				"pid", metric.PID,
				"cpuPercent", metric.CPUPercent,
				"memoryMB", metric.WorkingSetSizeMB)
		},
	})
	go wd.Start(wdCtx)

	// Initialize file index (non-fatal if it fails). Done before application.New
	// so the HomeService bindings can receive the lifecycle pointer.
	rootPaths := fm.RootPaths()
	var idxLifecycle *index.Lifecycle
	if lc, err := index.Init(dataDir, rootPaths); err != nil {
		platform.Logger().Warn("file index init failed", "error", err)
	} else {
		idxLifecycle = lc
	}

	// The Sheets editor runs on the in-process pure-Go workbook engine
	// (excelize); there is no external sidecar process.
	wbEngine := workbook.NewEngine()

	homeSvc := bridge.NewHomeService(
		buildinfo.Version, store, rm, fm, tabHost, fo, dam, idxLifecycle, openFileFn,
		platform.RevealPath,
	)

	app := application.New(application.Options{
		Name:        "YiiOffice",
		Description: "YiiOffice desktop office suite",
		Logger:      consoleLogger,
		LogLevel:    consoleLogLevel,
		// ServerOptions are ignored by desktop builds and take effect only with
		// `-tags server`, where the same services are served over HTTP so the
		// E2E suite can drive the real Go backend with Playwright
		// (https://v3.wails.io/guides/e2e-testing/). Loopback only by default;
		// WAILS_SERVER_HOST / WAILS_SERVER_PORT still override both values.
		Server: application.ServerOptions{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Assets: application.AssetOptions{
			// WithLocalFiles backs `<img src="/md-asset?p=…">`: markdown notes
			// reference pictures that live next to the .md file, and a same-origin
			// route is the only way to show them without a custom webview scheme.
			// The authoriser is read per request, so adding a sidebar folder takes
			// effect without a restart.
			Handler: assets.New(dist, assets.WithLocalFiles(bridge.LocalImageFile(fm.RootPaths))),
		},
		// ErrorHandler catches bridge call errors (e.g. invalid args,
		// service panics caught by the runtime) before they reach the user.
		ErrorHandler: func(err error) {
			if err == nil {
				return
			}
			platform.Logger().Error("bridge call error", "error", err)
		},
		// PanicHandler catches service-layer panics. Complements the startup
		// defer-recover above (which only runs in main).
		PanicHandler: func(details *application.PanicDetails) {
			dataDir, _ := host.AppDataDir()
			errValue := fmt.Sprintf("%v", details.Error)
			if path, err := diagnose.WriteCrashReport(dataDir, errValue, []byte(details.FullStackTrace)); err == nil {
				platform.Logger().Warn("crash report written", "path", path)
			}
			platform.Logger().Error("service panic",
				"error", details.Error,
				"stack", details.FullStackTrace)
		},
		Services: []application.Service{
			// Registered first so it shuts down last (reverse order), after all
			// frontend-facing services are done.
			application.NewService(bridge.NewInternalService(idxLifecycle, wbEngine, cancelWd)),
			// Local image reads are authorised against the folder roots the
			// sidebar exposes (plus the user profile), not against "anything
			// under home": a folder added on another drive has to stay
			// readable, and device names / ADS / symlink escapes must not.
			application.NewService(bridge.NewShellService(func(u string) error {
				return platform.OpenExternal(u)
			}, fm.RootPaths)),
			application.NewService(bridge.NewTabService(tabHost, detachedHost)),
			application.NewService(homeSvc),
			application.NewService(bridge.NewDocsService(rm, idxLifecycle)),
			application.NewService(bridge.NewSlidesService(rm)),
			application.NewService(bridge.NewPdfService(rm)),
			application.NewService(bridge.NewMarkdownService(rm, fm.RootPaths)),
			application.NewService(bridge.NewWorkbookService(wbEngine, rm)),
			application.NewService(bridge.NewExportService()),
			// Frameless main window: the tab strip is the title bar, so the
			// shell draws the caption buttons and drives them through here.
			application.NewService(bridge.NewWindowService(closeGuard.ShouldAllowClose)),
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
		OnShutdown: func() {
			platform.Logger().Info("application shutting down")
		},
		PostShutdown: func() {
			consoleLogger.Info("application terminated cleanly")
		},
	})
	platform.Set(app)

	// The updater needs the application's host adapter, so it is configured
	// after application.New and registered as a service for the shell.
	updateSvc, err := update.New(app, buildinfo.Version)
	if err != nil {
		platform.Logger().Warn("updater disabled", "error", err)
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
		Windows: application.WindowsWindow{
			// Lets WebView2 turn the strip's `-webkit-app-region: drag` into a
			// native caption (move the window, double-click to maximise).
			// Ignored on runtimes that predate the setting.
			NonClientRegionSupport: true,
		},
	})

	installSystemTray(app, win, closeGuard)

	// Files passed on the command line (file association or a second launch
	// before the running instance existed).
	openFilesFromArgs(homeSvc, os.Args[1:])

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
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
			platform.Logger().Warn("open file from args failed", "path", arg, "error", err)
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
