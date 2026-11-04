// Package assets serves the bundled renderer bundles over a single origin.
package assets

import (
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
)

// init pins the module-script extension for ServeContent's type lookup. On
// Windows the mime package seeds its extension table from the HKCR registry,
// which overrides the built-in entries — and Go only ignores the notorious
// ".js" → "text/plain" setting (issue #32350), not ".mjs". A runner image that
// registered ".mjs" as text/plain made this handler answer the pdf.js worker
// with text/plain + nosniff, Chromium refused the module script, and every PDF
// failed to open in CI while passing on dev machines whose registry is clean.
// AddExtensionType runs after the registry scan (package init order) and
// overrides whatever it recorded.
func init() { pinModuleScriptMIME() }

func pinModuleScriptMIME() {
	_ = mime.AddExtensionType(".mjs", "text/javascript")
}

// contentSecurityPolicy is the response-header policy applied to every bundle.
// A response header and a document's <meta> policy are enforced as the
// intersection of the two, so this header must be a *superset* of what each
// renderer declares in its own index.html — otherwise it silently narrows the
// per-app policy. It used to say `connect-src 'self'` only, which blocked
// `fetch(blob:…)`: the docs editor hands an opened .docx to its parser as a
// blob URL, so every opened document failed with "Refused to connect" and the
// tab stayed blank. Keep this list in sync with the most permissive app meta;
// the per-app <meta> tags remain the tighter, app-specific layer.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'wasm-unsafe-eval'; " +
	"style-src 'self' 'unsafe-inline'; " +
	// Local pictures arrive from the /md-asset route below, i.e. the document's
	// own origin, so `'self'` covers them and no custom scheme has to be
	// allowed.
	"img-src 'self' data: blob:; " +
	"font-src 'self' data: blob:; " +
	"media-src 'self' data: blob:; " +
	// 'self' already covers same-origin WebSocket (the Wails event bridge), so no
	// ws://localhost:* wildcard is needed here — that entry only exists in the
	// dev <meta> tags for Vite's HMR socket.
	"connect-src 'self' data: blob:; " +
	"worker-src 'self' blob:; " +
	"frame-src 'self'; " +
	"object-src 'none'; base-uri 'none'; form-action 'none'"

// localAssetPath is the route that serves a picture living next to a document
// (a markdown note's sibling images) straight from disk.
//
// It exists because a `file://` subresource is blocked when the renderer runs
// on the app's http origin, and a custom scheme has to be registered with the
// webview. A same-origin route needs neither: the renderer writes
// `<img src="/md-asset?p=<path>">` and the bytes arrive under `img-src 'self'`.
const localAssetPath = "/md-asset"

// maxLocalAssetBytes caps one response. The webview streams to disk, but a
// renderer can point the route at any authorised path, so the cap keeps a
// mis-sized file (a 4 GB video typed into `![x](…)`) from being piped through.
const maxLocalAssetBytes = 64 << 20

// apps lists the renderer bundles mounted under /<name>/. Every Vite app in
// frontend/apps must be listed here, otherwise its tab frame 404s.
var apps = []string{"shell", "docs", "sheets", "slides", "pdf", "markdown"}

// Server maps URL prefixes to embedded bundle directories.
type Server struct {
	root fs.FS
	apps map[string]struct{}
	// resolve maps a local asset request to the file it may serve. Nil means
	// the route is disabled (a build with no folder roots configured).
	resolve func(raw string) (string, error)
}

// Option customises a Server at construction time.
type Option func(*Server)

// WithLocalFiles enables the /md-asset route.
//
// resolve is the authorisation policy — roots, allowed extensions, symlink
// resolution — and returns the canonical path to serve. Keeping it a caller
// function means this package stays a transport: the same policy that guards
// ShellService.ReadLocalImage guards the HTTP route, so the two can never
// disagree about which files a renderer may read.
func WithLocalFiles(resolve func(raw string) (string, error)) Option {
	return func(s *Server) {
		s.resolve = resolve
	}
}

// New builds a handler over the given bundle root (normally frontend/dist).
func New(root fs.FS, opts ...Option) *Server {
	set := make(map[string]struct{}, len(apps))
	for _, name := range apps {
		set[name] = struct{}{}
	}
	s := &Server{root: root, apps: set}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if hasDotDot(r.URL.Path) {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}

	clean := path.Clean("/" + r.URL.Path)
	if clean == localAssetPath {
		s.serveLocalAsset(w, r)
		return
	}
	if clean == "/" {
		s.serveApp(w, r, "shell", "index.html")
		return
	}

	trimmed := strings.TrimPrefix(clean, "/")
	app, rest, _ := strings.Cut(trimmed, "/")
	if _, ok := s.apps[app]; !ok {
		// The shell bundle is served at "/", so its relative "./assets/..." URLs
		// arrive without a /shell/ prefix. Resolve anything that is not a mounted
		// app against the shell bundle.
		s.serveApp(w, r, "shell", trimmed)
		return
	}
	if rest == "" {
		rest = "index.html"
	}
	s.serveApp(w, r, app, rest)
}

// serveLocalAsset answers `<img src="/md-asset?p=<path>">` with the file's
// bytes. The path arrives already authorised: resolve (see WithLocalFiles)
// applies the root set, the image-extension allowlist and symlink resolution,
// and returns the canonical path, so what is opened here is what was checked.
func (s *Server) serveLocalAsset(w http.ResponseWriter, r *http.Request) {
	if s.resolve == nil {
		http.Error(w, "local files are not available", http.StatusNotImplemented)
		return
	}
	raw := r.URL.Query().Get("p")
	if strings.TrimSpace(raw) == "" {
		http.Error(w, "missing p", http.StatusBadRequest)
		return
	}
	// One status for every rejection: the reason would tell a renderer whether
	// a path exists outside the roots, which is a filesystem oracle.
	safe, err := s.resolve(raw)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	f, err := os.Open(safe)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if info.Size() > maxLocalAssetBytes {
		http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
		return
	}
	// Users edit these files in other applications while the note is open, so a
	// cached response would keep showing the previous picture. ServeContent
	// still answers conditional requests from the modification time.
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

func (s *Server) serveApp(w http.ResponseWriter, r *http.Request, app, name string) {
	sub, err := fs.Sub(s.root, app)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	target := path.Clean(name)
	if !exists(sub, target) {
		if !strings.Contains(path.Base(target), ".") {
			target = "index.html"
		}
	}
	s.serveFile(w, r, sub, target)
}

// immutableAssets is the cache policy for Vite's content-addressed bundles:
// the hash in the file name changes whenever the bytes do, so a response may
// never be revalidated. Refreshing a tab used to re-download the whole ~9.6MB
// of renderer bundles because embed.FS reports a zero ModTime and ServeContent
// therefore emitted no validators at all.
const immutableAssets = "public, max-age=31536000, immutable"

// revalidatingAssets applies to entry documents (index.html and the SPA
// fallback) and to any unhashed file: the browser may store it, but must ask
// before reusing it. `no-cache` rather than `no-store` keeps the stored copy
// eligible for a conditional request once a validator exists; a serving
// process that ships the same bytes can then answer 304 instead of resending.
const revalidatingAssets = "no-cache"

// isImmutableAsset reports whether name is a content-hashed file under an
// assets/ directory, the only place Vite emits content-addressed output. The
// name, not the directory, decides: unhashed static payloads (pdf.js cmaps,
// standard fonts) share that prefix and must keep revalidating.
//
// Vite's default hash is eight base64url characters appended as the last dash
// segment — `index-d2rDcZic.js`, `pdf.worker.min-CIqJB0yW.mjs`,
// `Caladea-Bold-D8qQyaGr.ttf`. Some chunk names already carry their own hash
// (`architecture-WOLXFQ4H-DuO9-Eo4.js`), so any segment qualifies. Requiring
// an uppercase letter or digit rejects long lowercase words such as
// `Adobe-CNS1-UCS2.bcmap`, where `UCS2` is an encoding name, not a hash.
func isImmutableAsset(name string) bool {
	base := path.Base(name)
	dot := strings.LastIndexByte(base, '.')
	if dot < 0 {
		return false
	}
	inAssetsDir := false
	for _, segment := range strings.Split(path.Dir(name), "/") {
		if segment == "assets" {
			inAssetsDir = true
			break
		}
	}
	if !inAssetsDir {
		return false
	}
	for _, token := range strings.Split(base[:dot], "-") {
		if len(token) != 8 || !strings.ContainsAny(token, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
			continue
		}
		if !strings.ContainsRune(token, '.') {
			return true
		}
	}
	return false
}

func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, sub fs.FS, name string) {
	f, err := sub.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		http.NotFound(w, r)
		return
	}
	if isImmutableAsset(name) {
		w.Header().Set("Cache-Control", immutableAssets)
	} else {
		w.Header().Set("Cache-Control", revalidatingAssets)
	}
	if sr, ok := f.(io.ReadSeeker); ok {
		http.ServeContent(w, r, fi.Name(), fi.ModTime(), sr)
	} else {
		http.NotFound(w, r)
	}
}

func exists(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && !info.IsDir()
}

func hasDotDot(p string) bool {
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return true
		}
	}
	return false
}
