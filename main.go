//go:build windows

package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"gitee.com/ethanbourne789/yiioffice/internal/assets"
	"gitee.com/ethanbourne789/yiioffice/internal/bridge"
	"gitee.com/ethanbourne789/yiioffice/internal/buildinfo"
	"gitee.com/ethanbourne789/yiioffice/internal/host"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

//go:embed all:frontend/dist
var embeddedAssets embed.FS

func main() {
	if err := platform.RequireWindows(); err != nil {
		log.Fatal(err)
	}

	dist, err := fs.Sub(embeddedAssets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}

	dataDir, err := host.AppDataDir()
	if err != nil {
		log.Fatal(err)
	}
	store, err := host.NewSettingsStore(dataDir)
	if err != nil {
		log.Fatal(err)
	}

	router := bridge.NewRouter()
	bridge.RegisterHome(router, store, buildinfo.Version)
	bridge.RegisterTabs(router)

	app := application.New(application.Options{
		Name:        "YiiOffice",
		Description: "YiiOffice desktop office suite",
		Assets: application.AssetOptions{
			Handler: assets.New(dist),
		},
		Services: []application.Service{
			application.NewService(bridge.NewService(router)),
		},
	})
	platform.Set(app)

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "YiiOffice " + buildinfo.Version,
		Width:  1280,
		Height: 800,
		URL:    "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
