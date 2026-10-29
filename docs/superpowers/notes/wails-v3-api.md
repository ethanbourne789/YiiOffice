# Wails V3 API Notes (beta.28)

> Discovered from `wails3 init -n scaffold -t vanilla` + source inspection on 2026-10-29.

## Application Creation

```go
app := application.New(application.Options{...})
```

### `application.Options` Fields (relevant)

| Field | Type | Notes |
|---|---|---|
| `Name` | `string` | Application name |
| `Description` | `string` | Description |
| `Services` | `[]application.Service` | Bound Go services |
| `Assets` | `application.AssetOptions` | Asset server config |
| `Mac` | `application.MacOptions` | macOS-specific |
| `Windows` | `application.WindowsOptions` | Windows-specific |
| `Linux` | `application.LinuxOptions` | Linux-specific |
| `Logger` | `*slog.Logger` | Optional custom logger |
| `LogLevel` | `slog.Level` | Log level |
| `OnShutdown` | `func()` | Pre-shutdown hook |
| `PostShutdown` | `func()` | Post-shutdown hook |
| `ShouldQuit` | `func() bool` | Quit gate |
| `ErrorHandler` | `func(error)` | Error handler |
| `PanicHandler` | `func(*PanicDetails)` | Panic handler |
| `WarningHandler` | `func(string)` | Warning handler |
| `KeyBindings` | `map[string]func(window Window)` | Global keybindings |
| `SingleInstance` | `*SingleInstanceOptions` | Single-instance mode |
| `Transport` | `Transport` | Custom IPC transport |
| `Server` | `ServerOptions` | Server mode config |

## Asset Options

```go
application.AssetOptions{
    Handler: application.AssetFileServerFS(assets), // http.Handler
}
```

- `application.AssetFileServerFS(fs.FS) http.Handler` — serve from embedded FS
- `application.BundledAssetFileServer(fs.FS) http.Handler` — with runtime.js

## Services

```go
application.NewService[T any](instance *T) application.Service
application.NewServiceWithOptions[T any](instance *T, opts application.ServiceOptions) application.Service
app.RegisterService(service application.Service) // before app.Run()
```

Service interfaces:
- `ServiceName() string` — optional name
- `ServiceStartup(ctx context.Context, opts ServiceOptions) error` — startup hook
- `ServiceShutdown() error` — shutdown hook

## Window Creation

```go
app.Window.NewWithOptions(application.WebviewWindowOptions{...})
```

**NOT** `app.NewWebviewWindowWithOptions()` — it's `app.Window.NewWithOptions()`.

### `application.WebviewWindowOptions` Fields (relevant)

| Field | Type | Notes |
|---|---|---|
| `Name` | `string` | Unique window name |
| `Title` | `string` | Window title |
| `Width` | `int` | Starting width |
| `Height` | `int` | Starting height |
| `URL` | `string` | URL to load (e.g., "/") |
| `MinWidth` | `int` | Minimum width |
| `MinHeight` | `int` | Minimum height |
| `MaxWidth` | `int` | Maximum width |
| `MaxHeight` | `int` | Maximum height |
| `Frameless` | `bool` | Remove frame |
| `Hidden` | `bool` | Start hidden |
| `AlwaysOnTop` | `bool` | Float above others |
| `BackgroundColour` | `application.RGBA` | Background color |
| `Mac` | `application.MacWindow` | macOS window options |
| `Windows` | `application.WindowsWindow` | Windows window options |
| `Linux` | `application.LinuxWindow` | Linux window options |

## Application Run

```go
err := app.Run()
```

Blocks until the application exits.

## Events

```go
// Emit custom event to frontend
cancelled := app.Event.Emit("eventname", data)

// Listen on custom events
unsub := app.Event.On("eventname", func(event *application.CustomEvent) {
    // event.Data holds the payload
})

// Register typed event (for binding generator)
application.RegisterEvent[string]("eventname")
```

**NOT** `app.EmitEvent()` — it's `app.Event.Emit(name, data...)`.

Event types:
- `application.CustomEvent` — has `Name string`, `Data any`, `Sender string`, `Cancel()`, `IsCancelled()`

## Main Thread Dispatch (NO `RunOnMainThread`)

These are **package-level functions**, NOT methods on `*App`:

```go
// Fire-and-forget
application.InvokeAsync(func() { /* ... */ })

// Blocking — waits for completion
application.InvokeSync(func() { /* ... */ })

// Blocking with result
res := application.InvokeSyncWithResult(func() T { return value })

// Blocking with error
err := application.InvokeSyncWithError(func() error { return nil })
```

There is NO `app.RunOnMainThread()` in beta.28.

## Application Handle

```go
app := application.Get() // returns *application.App (global singleton)
```

`application.New()` sets a global singleton. Subsequent calls return the same instance.

## Color

```go
application.RGBA{Red: r, Green: g, Blue: b, Alpha: a}
application.NewRGB(r, g, b)     // alpha defaults to 255
application.NewRGBA(r, g, b, a)
```

## Window Manager

```go
app.Window.GetByName(name)    (Window, bool)
app.Window.Get(name)          (Window, bool)  // alias
app.Window.GetByID(id)        (Window, bool)
app.Window.Current()          Window          // active window (may be nil)
app.Window.GetAll()           []Window
app.Window.OnCreate(callback func(Window))
app.Window.Add(window Window)
app.Window.Remove(windowID uint)
```

## Other Managers

```go
app.ContextMenu  *ContextMenuManager
app.KeyBinding   *KeyBindingManager
app.Browser      *BrowserManager
app.Env          *EnvironmentManager
app.Dialog       *DialogManager
app.Event        *EventManager
app.Menu         *MenuManager
app.Screen       *ScreenManager
app.Clipboard    *ClipboardManager
app.SystemTray   *SystemTrayManager
app.Autostart    *AutostartManager
app.GlobalShortcut *GlobalShortcutManager
app.Updater      *updater.Updater
```

## App Methods

```go
app.Run() error
app.Quit()
app.Context() context.Context
app.OnShutdown(f func())
app.Config() Options
app.GetPID() int
app.SetIcon(icon []byte)
app.Hide()
app.Show()
app.RegisterService(service Service)
```

## Build Tags

- `production` — production mode (minified runtime, no dev tools)
- `server` — headless server mode
- `devtools` — enable devtools on macOS
- `private_mac_apis` — private macOS APIs
