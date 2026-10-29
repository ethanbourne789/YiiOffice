//go:build windows

// Package watchdog monitors WebView2 renderer process resources.
package watchdog

import (
	"fmt"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ProcessMetric holds CPU and memory data for a single process.
type ProcessMetric struct {
	PID              uint32
	CPUPercent       float64 // single-core percentage
	WorkingSetSizeMB float64
	ProcessName      string
}

// processEntry32 is a minimal WINSHELLAPI PROCESSENTRY32.
type processEntry32 struct {
	Size             uint32
Usage              uint32
ProcID             uint32
DefaultHeap        syscall.Handle
ModuleID           uint32
Threads            uint32
ParentProcID       uint32
PriorityClass      int32
Flags              uint32
ExeFile            [260]uint16
}

const (
	th32CS_SNAPPROCESS = 0x00000002
	maxPath            = 260
)

// Windows API handles
var (
	kernel32DLL = syscall.NewLazyDLL("kernel32.dll")
	psapiDLL    = syscall.NewLazyDLL("psapi.dll")

	procCreateToolhelp32Snap = kernel32DLL.NewProc("CreateToolhelp32Snapshot")
	procProcess32FirstW      = kernel32DLL.NewProc("Process32FirstW")
	procProcess32NextW       = kernel32DLL.NewProc("Process32NextW")
	procGetProcessMemoryInfo = psapiDLL.NewProc("GetProcessMemoryInfo")
)

// GetWebView2Processes finds all msedgewebview2.exe processes and returns their metrics.
func GetWebView2Processes() ([]ProcessMetric, error) {
	return getProcessesByName("msedgewebview2.exe")
}

// GetAllWebView2RelatedProcesses finds all WebView2-related processes (msedgewebview2.exe and MicrosoftEdgeUpdate.exe).
func GetAllWebView2RelatedProcesses() ([]ProcessMetric, error) {
	all := []ProcessMetric{}
	for _, name := range []string{"msedgewebview2.exe"} {
		metrics, err := getProcessesByName(name)
		if err != nil {
			return nil, err
		}
		all = append(all, metrics...)
	}
	return all, nil
}

func getProcessesByName(targetName string) ([]ProcessMetric, error) {
	h, _, _ := procCreateToolhelp32Snap.Call(
		uintptr(th32CS_SNAPPROCESS),
		0,
	)
	if h == 0 {
		return nil, fmt.Errorf("CreateToolhelp32Snapshot failed")
	}
	defer windows.CloseHandle(windows.Handle(h))

	var entry processEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))

	ret, _, _ := procProcess32FirstW.Call(h, uintptr(unsafe.Pointer(&entry)))
	if ret == 0 {
		return nil, fmt.Errorf("Process32First failed")
	}

	var matched []ProcessMetric
	targetLower := strings.ToLower(targetName)

	for {
		exe := syscall.UTF16ToString(entry.ExeFile[:])
		if strings.ToLower(exe) == targetLower {
			pm, err := getProcessMetric(entry.ProcID, exe)
			if err != nil {
				// Skip processes we can't query
				continue
			}
			matched = append(matched, pm)
		}

		ret, _, _ := procProcess32NextW.Call(h, uintptr(unsafe.Pointer(&entry)))
		if ret == 0 {
			break
		}
	}

	return matched, nil
}

// processMemoryCounters is a minimal PROCESS_MEMORY_COUNTERS_EX.
type processMemoryCounters struct {
	Cb                          uint32
	PageFaultCount              uint32
	PeakWorkingSetSize          uintptr
	WorkingSetSize              uintptr
	QuotaPeakPagedPoolUsage     uintptr
	QuotaPagedPoolUsage         uintptr
	QuotaPeakNonPagedPoolUsage  uintptr
	QuotaNonPagedPoolUsage      uintptr
	PagefileUsage               uintptr
	PeakPagefileUsage           uintptr
	PrivateUsage                uintptr
}

func getProcessMetric(pid uint32, name string) (ProcessMetric, error) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION|windows.PROCESS_VM_READ|windows.PROCESS_DUP_HANDLE, false, pid)
	if err != nil {
		return ProcessMetric{}, err
	}
	defer windows.CloseHandle(h)

	// Get memory info
	var counters processMemoryCounters
	counters.Cb = uint32(unsafe.Sizeof(counters))
	r1, _, _ := procGetProcessMemoryInfo.Call(
		uintptr(h),
		uintptr(unsafe.Pointer(&counters)),
		uintptr(counters.Cb),
	)
	if r1 == 0 {
		return ProcessMetric{}, fmt.Errorf("GetProcessMemoryInfo failed for PID %d", pid)
	}

	// Convert working set to MB
	wsMB := float64(counters.WorkingSetSize) / (1024 * 1024)

	return ProcessMetric{
		PID:              pid,
		WorkingSetSizeMB: wsMB,
		ProcessName:      name,
	}, nil
}

// cpuTracker tracks CPU usage between samples.
type cpuTracker struct {
	mu          sync.Mutex
	lastCPU     map[uint32]int64 // last kernel+user time in 100ns units
	lastSample  map[uint32]int64 // last wall-clock time in 100ns units
}

var globalCPUTracker = &cpuTracker{
	lastCPU:    make(map[uint32]int64),
	lastSample: make(map[uint32]int64),
}

// UpdateCPUPercent calculates CPU percentage from the previous sample.
// Call this after GetWebView2Processes on each sample.
func UpdateCPUPercent(metrics []ProcessMetric) {
	globalCPUTracker.mu.Lock()
	defer globalCPUTracker.mu.Unlock()

	// Get current wall-clock time (100ns units since 1601)
	var currentTime int64
	syscall.GetSystemTimeAsFileTime((*syscall.Filetime)(unsafe.Pointer(&currentTime)))

	// GetProcessTimes proc
	procGetProcessTimes := kernel32DLL.NewProc("GetProcessTimes")

	for i := range metrics {
		pid := metrics[i].PID

		// Open process for query
		h, err := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION, false, pid)
		if err != nil {
			continue
		}

		var create, exit, kernel, user syscall.Filetime
		r1, _, _ := procGetProcessTimes.Call(
			uintptr(h),
			uintptr(unsafe.Pointer(&create)),
			uintptr(unsafe.Pointer(&exit)),
			uintptr(unsafe.Pointer(&kernel)),
			uintptr(unsafe.Pointer(&user)),
		)
		windows.CloseHandle(h)

		if r1 == 0 {
			continue
		}

		// Convert to 100ns integers
		kernelInt := int64(kernel.HighDateTime)<<32 | int64(uint32(kernel.LowDateTime))
		userInt := int64(user.HighDateTime)<<32 | int64(uint32(user.LowDateTime))
		totalCPU := kernelInt + userInt

		if lastCPU, ok := globalCPUTracker.lastCPU[pid]; ok {
			cpuDelta := totalCPU - lastCPU
			wallDelta := currentTime - globalCPUTracker.lastSample[pid]

			if wallDelta > 0 {
				// Single-core percentage (not divided by num CPUs)
				pct := (float64(cpuDelta) / float64(wallDelta)) * 100.0
				metrics[i].CPUPercent = pct
			}
		}

		globalCPUTracker.lastCPU[pid] = totalCPU
		globalCPUTracker.lastSample[pid] = currentTime
	}
}
