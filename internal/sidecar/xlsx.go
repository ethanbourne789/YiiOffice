package sidecar

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// XlsxManager manages the xlsx-sidecar Rust process for sheets operations.
type XlsxManager struct {
	binaryPath string
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	stdout     *bufio.Reader
	requestID  atomic.Int64
	mu         sync.Mutex
	pending    map[int64]chan SidecarResponse
	done       chan struct{}
}

// SidecarRequest is a JSON-RPC request to the sidecar.
type SidecarRequest struct {
	ID     int64                  `json:"id"`
	Method string                 `json:"method"`
	Params map[string]interface{} `json:"params"`
}

// SidecarResponse is a JSON-RPC response from the sidecar.
type SidecarResponse struct {
	ID     int64                `json:"id"`
	Result map[string]interface{} `json:"result,omitempty"`
	Error  *struct {
		Code    int64  `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// NewXlsxManager creates and starts the sidecar process.
// Returns an error if the sidecar binary is not found (non-fatal).
func NewXlsxManager(binaryDir string) (*XlsxManager, error) {
	binaryPath := filepath.Join(binaryDir, "xlsx-sidecar.exe")
	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("xlsx-sidecar binary not found: %s", binaryPath)
	}

	cmd := exec.Command(binaryPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}

	m := &XlsxManager{
		binaryPath: binaryPath,
		cmd:        cmd,
		stdin:      stdin,
		stdout:     bufio.NewReader(stdout),
		pending:    make(map[int64]chan SidecarResponse),
		done:       make(chan struct{}),
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start sidecar: %w", err)
	}

	// Start response reader goroutine.
	go m.readLoop()

	return m, nil
}

func (m *XlsxManager) readLoop() {
	for {
		line, err := m.stdout.ReadString('\n')
		if err != nil {
			// Process exited or pipe broken.
			m.mu.Lock()
			for _, ch := range m.pending {
				ch <- SidecarResponse{
					Error: &struct {
						Code    int64  `json:"code"`
						Message string `json:"message"`
					}{
						Code:    -1,
						Message: "sidecar process exited",
					},
				}
				close(ch)
			}
			m.mu.Unlock()
			return
		}

		var resp SidecarResponse
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			continue
		}

		m.mu.Lock()
		ch, ok := m.pending[resp.ID]
		if ok {
			delete(m.pending, resp.ID)
			select {
			case ch <- resp:
			default:
			}
			close(ch)
		}
		m.mu.Unlock()
	}
}

// Call sends a JSON-RPC request to the sidecar and waits for the response.
func (m *XlsxManager) Call(method string, params map[string]interface{}) (SidecarResponse, error) {
	m.mu.Lock()
	id := m.requestID.Add(1)
	ch := make(chan SidecarResponse, 1)
	m.pending[id] = ch
	m.mu.Unlock()

	req := SidecarRequest{
		ID:     id,
		Method: method,
		Params: params,
	}
	data, err := json.Marshal(req)
	if err != nil {
		return SidecarResponse{}, err
	}
	data = append(data, '\n')

	if _, err := m.stdin.Write(data); err != nil {
		return SidecarResponse{}, fmt.Errorf("write request: %w", err)
	}

	select {
	case resp := <-ch:
		if resp.Error != nil {
			return resp, fmt.Errorf("sidecar error %d: %s", resp.Error.Code, resp.Error.Message)
		}
		return resp, nil
	case <-time.After(120 * time.Second):
		return SidecarResponse{}, fmt.Errorf("sidecar request timeout after 120s")
	case <-m.done:
		return SidecarResponse{}, fmt.Errorf("sidecar closed")
	}
}

// Open opens a workbook in the sidecar.
func (m *XlsxManager) Open(path string) (SidecarResponse, error) {
	return m.Call("open", map[string]interface{}{
		"path": path,
	})
}

// ReadRange reads a cell range from a sheet.
func (m *XlsxManager) ReadRange(sessionID, sheet, cellRange string) (SidecarResponse, error) {
	return m.Call("read_range", map[string]interface{}{
		"session_id": sessionID,
		"sheet":      sheet,
		"range":      cellRange,
	})
}

// ReadFormulas reads formulas from a sheet.
func (m *XlsxManager) ReadFormulas(sessionID, sheet string) (SidecarResponse, error) {
	return m.Call("read_formulas", map[string]interface{}{
		"session_id": sessionID,
		"sheet":      sheet,
	})
}

// Recalc triggers formula recalculation.
func (m *XlsxManager) Recalc(sessionID string) (SidecarResponse, error) {
	return m.Call("recalc", map[string]interface{}{
		"session_id": sessionID,
	})
}

// FindCells searches for cells matching criteria.
func (m *XlsxManager) FindCells(sessionID, sheet, query string) (SidecarResponse, error) {
	return m.Call("find_cells", map[string]interface{}{
		"session_id": sessionID,
		"sheet":      sheet,
		"query":      query,
	})
}

// ReadRowOutline reads row outline levels.
func (m *XlsxManager) ReadRowOutline(sessionID, sheet string) (SidecarResponse, error) {
	return m.Call("read_row_outline", map[string]interface{}{
		"session_id": sessionID,
		"sheet":      sheet,
	})
}

// ReadMedia reads embedded media resources.
func (m *XlsxManager) ReadMedia(sessionID string) (SidecarResponse, error) {
	return m.Call("read_media", map[string]interface{}{
		"session_id": sessionID,
	})
}

// ReadPivotDefinition reads pivot table definitions.
func (m *XlsxManager) ReadPivotDefinition(sessionID, sheet string) (SidecarResponse, error) {
	return m.Call("read_pivot_definition", map[string]interface{}{
		"session_id": sessionID,
		"sheet":      sheet,
	})
}

// Close closes a workbook session.
func (m *XlsxManager) Close(sessionID string) (SidecarResponse, error) {
	return m.Call("close", map[string]interface{}{
		"session_id": sessionID,
	})
}

// Stop kills the sidecar process.
func (m *XlsxManager) Stop() error {
	close(m.done)
	if m.stdin != nil {
		m.stdin.Close()
	}
	if m.cmd != nil && m.cmd.Process != nil {
		return m.cmd.Process.Kill()
	}
	return nil
}

// IsRunning returns true if the sidecar process is alive.
func (m *XlsxManager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd == nil || m.cmd.Process == nil {
		return false
	}
	// Process state check — will return error if process exited.
	return m.cmd.Process.Signal(nil) == nil || m.cmd.ProcessState == nil
}
