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

!include "LogicLib.nsh"

!define APP_NAME "YiiOffice"
!define APP_EXE "YiiOffice.exe"
!define APP_UNINSTALL_KEY "YiiOffice"

Name "${APP_NAME} Uninstaller"
OutFile "temp_uninstall.exe"
InstallDir "$LOCALAPPDATA\${APP_NAME}"

; Mirrors installer.nsi's UnregisterAssocOne: drop our OpenWithProgids entry
; and ProgID, then restore the default ONLY while it still points at us.
!macro UnregisterAssocOne EXT
  DeleteRegValue HKCU "Software\Classes\${EXT}\OpenWithProgids" "${APP_NAME}${EXT}"
  DeleteRegKey HKCU "Software\Classes\${APP_NAME}${EXT}"
  ReadRegStr $0 HKCU "Software\Classes\${EXT}" ""
  ${If} $0 == "${APP_NAME}${EXT}"
    ReadRegStr $1 HKCU "Software\${APP_NAME}\AssocBackup\${EXT}" ""
    ${If} $1 == ""
      DeleteRegValue HKCU "Software\Classes\${EXT}" ""
    ${Else}
      WriteRegStr HKCU "Software\Classes\${EXT}" "" "$1"
    ${EndIf}
  ${EndIf}
!macroend

; Reference-only stub: makensis refuses to compile a script whose only
; section is "Uninstall". This no-op section lets the file pass a syntax
; check; the shipped uninstaller is the "Uninstall" section embedded by
; installer.nsi's WriteUninstaller, never this build.
Section "Install (reference stub - never shipped)"
SectionEnd

Section "Uninstall"
  ; Mirrors installer.nsi: all shortcut variants (current root link + legacy
  ; per-app folder), then the folder only if it is empty.
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  !insertmacro UnregisterAssocOne ".docx"
  !insertmacro UnregisterAssocOne ".xlsx"
  !insertmacro UnregisterAssocOne ".pptx"
  !insertmacro UnregisterAssocOne ".pdf"
  !insertmacro UnregisterAssocOne ".md"

  DeleteRegKey HKCU "Software\Classes\.docx\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.xlsx\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.pptx\ShellNew"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${APP_NAME}\AssocBackup"
  DeleteRegKey HKCU "Software\${APP_NAME}\Capabilities"
  DeleteRegKey HKCU "Software\${APP_NAME}"
  RMDir /r "$INSTDIR"
SectionEnd
