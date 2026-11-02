; YiiOffice Uninstaller — reference only, NOT compiled by the pipeline.
;
; The uninstaller that ships is embedded in installer.nsi through
; WriteUninstaller("$INSTDIR\uninstall.exe"); that section is the source of
; truth. This file mirrors the registry keys it removes so they can be audited
; in one place; keep it in sync when the installer's Uninstall section changes.
;
; Install directory matches the installer's per-user location.

Unicode true
RequestExecutionLevel user

!define APP_NAME "YiiOffice"
!define APP_EXE "YiiOffice.exe"
!define APP_UNINSTALL_KEY "YiiOffice"

Name "${APP_NAME} Uninstaller"
OutFile "temp_uninstall.exe"
InstallDir "$LOCALAPPDATA\${APP_NAME}"

Section "Uninstall"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.docx"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.xlsx"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.pptx"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.pdf"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.md"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${APP_NAME}"
  RMDir /r "$INSTDIR"
  RMDir "$SMPROGRAMS\${APP_NAME}"
SectionEnd
