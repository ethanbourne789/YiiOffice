package bridge

import "gitee.com/ethanbourne789/yiioffice/internal/platform"

// NotificationService lets renderers raise a Windows system notification for
// results the user may not be looking at (a long export finishing, a background
// autosave failing). In-app feedback stays the primary channel; this is the
// fallback for when the window is not in front.
type NotificationService struct{}

// NewNotificationService returns a NotificationService.
func NewNotificationService() *NotificationService { return &NotificationService{} }

// Notify raises a system toast. The call is fire-and-forget: toast delivery is
// dispatched to the UI thread (where WinRT is initialized as STA) and failures
// are logged instead of surfacing as bridge errors the renderer cannot act on.
func (s *NotificationService) Notify(title string, body string) {
	platform.RunOnMain(func() {
		if err := platform.ShowNotification(title, body); err != nil {
			platform.Logger().Warn("system notification failed", "error", err)
		}
	})
}
