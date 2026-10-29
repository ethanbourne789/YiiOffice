# Tab Host Spike — Same-Origin iframe Bridge Reachability

## Purpose
Verify that docs editor iframes can reach window.top.wails through the wails-bridge transport.

## Date
2026-10-29

## Measurements

| Metric | Target | Actual |
| --- | --- | --- |
| iframe inner window.top.wails reachable | true | (pending manual test) |
| iframe inner aiOffice.getAppVersion() works | true | (pending manual test) |
| docs first paint DOMContentLoaded | < 2500ms | (pending manual test) |
| Process count (YiiOffice.exe + msedgewebview2.exe) | <= 12 | (pending manual test) |
| Resident memory (Home + 1 docs tab) | < 600MB | (pending manual test) |
| Editor keyboard input latency | no noticeable lag | (pending manual test) |
| Second docs tab — reuse or new iframe | new | (pending manual test) |

## Pass Criteria
- `window.top.wails` and `aiOffice` both true → same-origin iframe approach approved
- If either is false → Phase 2 must use postMessage relay

## Notes
- Spike component in shell with ?spike=1 query param
- Tabs channels return empty list in Phase 1 (no real tabs yet)
