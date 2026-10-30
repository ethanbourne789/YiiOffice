package bridge

import "log"

// DiagService is a TEMPORARY diagnostic bridge used to surface renderer-side
// errors (the WebView console is not reachable from this session). Remove it
// once the new-document investigation is done.
type DiagService struct{}

// Log writes a renderer message to the process log.
func (d *DiagService) Log(msg string) {
	log.Printf("[jsdiag] %s", msg)
}
