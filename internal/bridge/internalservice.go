package bridge

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"

	"gitee.com/ethanbourne789/yiioffice/internal/index"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
	"gitee.com/ethanbourne789/yiioffice/internal/workbook"
)

// InternalService manages the shutdown lifecycle for backend resources that
// are initialised before application.New (file index, workbook engine,
// watchdog). It exposes no methods to the frontend — it exists solely to
// honour the Wails v3 ServiceShutdown contract so that cleanup happens in the
// correct reverse-registration order instead of relying on scattered defer in
// main().
type InternalService struct {
	idxLc    *index.Lifecycle
	wbEngine *workbook.Engine
	cancelWd context.CancelFunc
}

// NewInternalService creates a new InternalService. Pass nil for any resource
// that failed to initialise.
func NewInternalService(idxLc *index.Lifecycle, wbEngine *workbook.Engine, cancelWd context.CancelFunc) *InternalService {
	return &InternalService{
		idxLc:    idxLc,
		wbEngine: wbEngine,
		cancelWd: cancelWd,
	}
}

// ServiceStartup is a no-op; all resources are already initialised before
// application.New.
func (s *InternalService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}

// ServiceShutdown tears down the resources in reverse startup order: watchdog,
// workbook engine, file index. Called after all OnShutdown hooks and after all
// other services have shut down.
func (s *InternalService) ServiceShutdown() error {
	platform.Logger().Info("InternalService shutting down")

	var firstErr error

	// 1. Stop watchdog
	if s.cancelWd != nil {
		s.cancelWd()
	}

	// 2. Close workbook engine
	if s.wbEngine != nil {
		s.wbEngine.CloseAll()
	}

	// 3. Shutdown file index
	if s.idxLc != nil {
		if err := s.idxLc.Shutdown(); err != nil {
			if firstErr != nil {
				return fmt.Errorf("shutdown errors: %w; %v", firstErr, err)
			}
			firstErr = err
		}
	}

	return firstErr
}
