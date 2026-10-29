//go:build windows

package main

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"gitee.com/ethanbourne789/yiioffice/internal/buildinfo"
	"gitee.com/ethanbourne789/yiioffice/internal/platform"
)

func main() {
	if err := platform.RequireWindows(); err != nil {
		log.Fatal(err)
	}

	app := application.New(application.Options{
		Name:        "YiiOffice",
		Description: "YiiOffice desktop office suite",
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
