// Package assets serves the bundled renderer bundles over a single origin.
package assets

import (
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'wasm-unsafe-eval'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self' data: blob:; " +
	"connect-src 'self'; " +
	"worker-src 'self' blob:; " +
	"frame-src 'self'; " +
	"object-src 'none'; base-uri 'none'; form-action 'none'"

// apps lists the renderer bundles mounted under /<name>/.
var apps = []string{"shell", "docs"}

// Server maps URL prefixes to embedded bundle directories.
type Server struct {
	root fs.FS
	apps map[string]struct{}
}

// New builds a handler over the given bundle root (normally frontend/dist).
func New(root fs.FS) *Server {
	set := make(map[string]struct{}, len(apps))
	for _, name := range apps {
		set[name] = struct{}{}
	}
	return &Server{root: root, apps: set}
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
	if clean == "/" {
		s.serveApp(w, r, "shell", "index.html")
		return
	}

	trimmed := strings.TrimPrefix(clean, "/")
	app, rest, _ := strings.Cut(trimmed, "/")
	if _, ok := s.apps[app]; !ok {
		http.NotFound(w, r)
		return
	}
	if rest == "" {
		rest = "index.html"
	}
	s.serveApp(w, r, app, rest)
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
