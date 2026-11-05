package host

import (
	"encoding/json"
	"sync"
)

// CloseSaveRequest is the payload Go publishes when the user picks "Save" in
// the close prompt. The shell fans it out to the dirty editor frames (same
// origin iframes), waits for each write, and answers with CloseSaveResult.
type CloseSaveRequest struct {
	RequestID int        `json:"requestId"`
	Tabs      []DirtyTab `json:"tabs"`
}

// CloseFlow drives the asynchronous save-before-close handshake.
//
// The close guard runs on the UI thread and the documents live in the
// renderer, so the guard cannot persist anything itself. CloseFlow publishes a
// request instead, refuses that close, and retries the quit once the renderer
// reports every dirty document is on disk. Answers to a superseded request are
// ignored, so a second close attempt cannot be confirmed by the first one's
// late reply.
type CloseFlow struct {
	request func(req CloseSaveRequest)
	quit    func()

	mu      sync.Mutex
	seq     int
	pending int
}

// NewCloseFlow wires the handshake to the two effects it needs: publishing the
// request to the renderer and retrying the quit after a successful save.
func NewCloseFlow(request func(req CloseSaveRequest), quit func()) *CloseFlow {
	return &CloseFlow{request: request, quit: quit}
}

// RequestSave asks the renderer to persist the given tabs. Safe to call with an
// empty list (no-op) and from the UI thread: publishing is asynchronous.
func (f *CloseFlow) RequestSave(tabs []DirtyTab) {
	if f == nil || len(tabs) == 0 || f.request == nil {
		return
	}
	f.mu.Lock()
	f.seq++
	id := f.seq
	f.pending = id
	f.mu.Unlock()

	f.request(CloseSaveRequest{RequestID: id, Tabs: tabs})
}

// Complete applies the renderer's answer and reports whether the quit was
// retried. A failed save leaves the window open so the user can retry or pick
// "Don't save" instead of losing the edits to a half-finished write.
func (f *CloseFlow) Complete(data any) bool {
	if f == nil {
		return false
	}
	requestID, ok, valid := parseCloseSaveResult(data)
	if !valid {
		return false
	}

	f.mu.Lock()
	if requestID != f.pending {
		// Stale answer: a newer close attempt superseded this request.
		f.mu.Unlock()
		return false
	}
	f.pending = 0
	f.mu.Unlock()

	if !ok || f.quit == nil {
		return false
	}
	f.quit()
	return true
}

// Pending reports whether a save request is still awaiting an answer. The
// tests use it to assert the handshake does not fire twice.
func (f *CloseFlow) Pending() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.pending != 0
}

// parseCloseSaveResult reads `{requestId, ok}` from an event payload. Wails
// decodes the frontend's object into map[string]any, whose numbers arrive as
// float64; the other numeric shapes are accepted so the flow keeps working if
// the payload is ever re-marshalled through encoding/json.
func parseCloseSaveResult(data any) (requestID int, ok bool, valid bool) {
	switch payload := data.(type) {
	case nil:
		return 0, false, false
	case map[string]any:
		id, idOK := numberToInt(payload["requestId"])
		flag, flagOK := payload["ok"].(bool)
		if !idOK || !flagOK {
			return 0, false, false
		}
		return id, flag, true
	default:
		// A re-marshalled payload ([]byte, json.RawMessage) still decodes.
		raw, err := json.Marshal(payload)
		if err != nil {
			return 0, false, false
		}
		var decoded struct {
			RequestID float64 `json:"requestId"`
			OK        bool    `json:"ok"`
		}
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return 0, false, false
		}
		return int(decoded.RequestID), decoded.OK, true
	}
}

func numberToInt(value any) (int, bool) {
	switch n := value.(type) {
	case float64:
		return int(n), true
	case float32:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	case json.Number:
		parsed, err := n.Int64()
		if err != nil {
			return 0, false
		}
		return int(parsed), true
	default:
		return 0, false
	}
}
