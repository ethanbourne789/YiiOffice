# Performance Baseline — Phase 7

> Measured on Windows 11, WebView2 runtime.

## Performance Budget Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Cold start | < 2.5s | Double-click exe to Home interactive |
| New document (blank) | < 1s | Create new doc to editor ready |
| Medium DOCX (~10MB) | < 3s | Open to editable state |
| Tab switch | < 200ms | Tab activate to render |
| Tab close | < 100ms | Tab close to DOM cleanup |
| Home (no tabs) | < 300MB | Total process + WebView2 RSS |
| Home + 1 docs tab | < 500MB | |
| Home + 3 tabs | < 800MB | docs/sheets/slides |
| Search 10k docs P95 | < 150ms | Verified in G3 |
| Live search latency | < 50ms | |

## Watchdog Parameters

| Parameter | Value |
|-----------|-------|
| SampleInterval | 30s |
| MemoryLimitMB | 1536 |
| CPULimitPercent | 90 (single-core) |
| HotSamplesBeforeReport | 10 |
| ReportCooldown | 15min |

## Measurement Scripts

### Cold Start (PowerShell)
```powershell
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
Start-Process ".\build\bin\YiiOffice.exe"
while (-not (Get-Process -Name YiiOffice -ErrorAction SilentlyContinue)) {
  Start-Sleep -Milliseconds 100
}
$stopwatch.Stop()
Write-Host "Cold start: $($stopwatch.ElapsedMilliseconds)ms"
```

### Memory Usage (PowerShell)
```powershell
$process = Get-Process -Name YiiOffice
$webView2 = Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue
$webView2MB = if ($webView2) { ($webView2 | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB } else { 0 }
$totalMB = ($process.WorkingSet64 / 1MB) + $webView2MB
Write-Host "Total memory: $([math]::Round($totalMB))MB"
```

## Notes
- Performance measurements should be taken after the app has been running for at least 30 seconds to warm up.
- WebView2 process memory varies significantly based on loaded content.
- The watchdog monitors msedgewebview2.exe processes continuously.
- E2E performance tests use generous limits (5s cold start, 3s tab switch) for CI environments.
