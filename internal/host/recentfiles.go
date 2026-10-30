package host

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"gitee.com/ethanbourne789/yiioffice/internal/fsutil"
)

const maxRecents = 200
const defaultRecentPageSize = 50

// RecentEntry is a single recent file record.
type RecentEntry struct {
	Path string `json:"path"`
	Ts   int64  `json:"ts"`
}

// StarredFile is a file with an optional group.
type StarredFile struct {
	Path  string `json:"path"`
	Group string `json:"group,omitempty"`
}

// FileInfo is a stat result for a single path.
type FileInfo struct {
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	Modified  int64  `json:"modified"`
	Available bool   `json:"available"`
}

// RecentManager manages recent and starred file lists.
type RecentManager struct {
	mu            sync.Mutex
	dir           string
	recents       []RecentEntry
	starred       []StarredFile
	starredGroups []string
}

// NewRecentManager loads or creates the recent files store.
func NewRecentManager(dataDir string) *RecentManager {
	rm := &RecentManager{
		dir:           dataDir,
		recents:       make([]RecentEntry, 0),
		starred:       make([]StarredFile, 0),
		starredGroups: []string{"Important", "Work"},
	}
	rm.load()
	return rm
}

func (rm *RecentManager) recentFile() string {
	return filepath.Join(rm.dir, "recent.json")
}

func (rm *RecentManager) starredFile() string {
	return filepath.Join(rm.dir, "starred.json")
}

func (rm *RecentManager) load() {
	// Load recents
	raw, err := os.ReadFile(rm.recentFile())
	if err == nil {
		json.Unmarshal(raw, &rm.recents)
	}
	// Load starred
	var starredData struct {
		Groups []string    `json:"groups"`
		Files  []StarredFile `json:"files"`
	}
	raw, err = os.ReadFile(rm.starredFile())
	if err == nil {
		json.Unmarshal(raw, &starredData)
		rm.starred = starredData.Files
		if len(starredData.Groups) > 0 {
			rm.starredGroups = starredData.Groups
		}
	}
}

func (rm *RecentManager) saveRecents() {
	fsutil.WriteJSONAtomic(rm.recentFile(), rm.recents, 0o644)
}

func (rm *RecentManager) saveStarred() {
	data := struct {
		Groups []string    `json:"groups"`
		Files  []StarredFile `json:"files"`
	}{Groups: rm.starredGroups, Files: rm.starred}
	fsutil.WriteJSONAtomic(rm.starredFile(), data, 0o644)
}

// AddRecent adds a path to the recent files list.
func (rm *RecentManager) AddRecent(path string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	now := time.Now().UnixMilli()
	// Remove existing entry for same path
	for i, r := range rm.recents {
		if strings.EqualFold(r.Path, path) {
			rm.recents = append(rm.recents[:i], rm.recents[i+1:]...)
			break
		}
	}
	rm.recents = append([]RecentEntry{{Path: path, Ts: now}}, rm.recents...)
	if len(rm.recents) > maxRecents {
		rm.recents = rm.recents[:maxRecents]
	}
	rm.saveRecents()
}

// GetRecents returns a paginated list of recent files with file stats.
func (rm *RecentManager) GetRecents(offset, limit int) []DocumentEntry {
	rm.mu.Lock()
	recents := make([]RecentEntry, len(rm.recents))
	copy(recents, rm.recents)
	stars := make(map[string]bool, len(rm.starred))
	for _, s := range rm.starred {
		stars[strings.ToLower(s.Path)] = true
	}
	rm.mu.Unlock()

	if limit <= 0 {
		limit = defaultRecentPageSize
	}
	if offset < 0 {
		offset = 0
	}
	if offset >= len(recents) {
		return []DocumentEntry{}
	}
	if offset+limit > len(recents) {
		limit = len(recents) - offset
	}

	result := make([]DocumentEntry, 0, limit)
	for _, r := range recents[offset : offset+limit] {
		entry := StatDocument(r.Path)
		entry.Starred = stars[strings.ToLower(r.Path)]
		result = append(result, entry)
	}
	return result
}

// RemoveRecent removes a path from recent files.
func (rm *RecentManager) RemoveRecent(path string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for i, r := range rm.recents {
		if strings.EqualFold(r.Path, path) {
			rm.recents = append(rm.recents[:i], rm.recents[i+1:]...)
			break
		}
	}
	rm.saveRecents()
}

// StatPaths stats a list of paths.
func (rm *RecentManager) StatPaths(paths []string) []FileInfo {
	result := make([]FileInfo, 0, len(paths))
	for _, p := range paths {
		info := FileInfo{Path: p}
		if stat, err := os.Stat(p); err == nil {
			info.Size = stat.Size()
			info.Modified = stat.ModTime().UnixMilli()
			info.Available = true
		}
		result = append(result, info)
	}
	return result
}

// ToggleStar toggles starred status of a path.
func (rm *RecentManager) ToggleStar(path string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for _, s := range rm.starred {
		if strings.EqualFold(s.Path, path) {
			// Unstar
			for i, s := range rm.starred {
				if strings.EqualFold(s.Path, path) {
					rm.starred = append(rm.starred[:i], rm.starred[i+1:]...)
					break
				}
			}
			rm.saveStarred()
			return false
		}
	}
	// Star
	rm.starred = append(rm.starred, StarredFile{Path: path})
	rm.saveStarred()
	return true
}

// GetStarred returns all starred files as home rows, newest first.
func (rm *RecentManager) GetStarred() []DocumentEntry {
	rm.mu.Lock()
	starred := make([]StarredFile, len(rm.starred))
	copy(starred, rm.starred)
	rm.mu.Unlock()

	result := make([]DocumentEntry, 0, len(starred))
	for _, s := range starred {
		entry := StatDocument(s.Path)
		entry.Starred = true
		entry.Group = s.Group
		result = append(result, entry)
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].MtimeMs > result[j].MtimeMs
	})
	return result
}

// GetStarredGroups returns all starred groups.
func (rm *RecentManager) GetStarredGroups() []string {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	return rm.starredGroups
}

// SetStarredGroup sets the group for a starred file.
func (rm *RecentManager) SetStarredGroup(path, group string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for i, s := range rm.starred {
		if strings.EqualFold(s.Path, path) {
			rm.starred[i].Group = group
			break
		}
	}
	rm.saveStarred()
}

// UnstarPaths removes multiple paths from starred files.
func (rm *RecentManager) UnstarPaths(paths []string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	result := make([]StarredFile, 0, len(rm.starred))
	for _, s := range rm.starred {
		found := false
		for _, p := range paths {
			if strings.EqualFold(s.Path, p) {
				found = true
				break
			}
		}
		if !found {
			result = append(result, s)
		}
	}
	rm.starred = result
	rm.saveStarred()
}

// IsStarred reports whether a path is in the starred list.
func (rm *RecentManager) IsStarred(path string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for _, s := range rm.starred {
		if strings.EqualFold(s.Path, path) {
			return true
		}
	}
	return false
}

// SortByTime sorts entries by timestamp descending (utility for tests).
func SortByTime(entries []RecentEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Ts > entries[j].Ts
	})
}
