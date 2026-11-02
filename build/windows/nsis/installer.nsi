; YiiOffice Windows Installer
; Per-user installation, no UAC required
;
; This file is the installer the build pipeline actually compiles:
;   task package:windows  ->  makensis build/windows/nsis/installer.nsi
; Everything it needs lives in the repository (app binary, ShellNew
; templates, icon), so a fresh clone can produce the same installer.

Unicode true
RequestExecutionLevel user
SetCompressor lzma

!define APP_NAME "YiiOffice"
; Version comes from Taskfile's VERSION (the same value that is linked into
; buildinfo.Version), so the installer never drifts from the binary:
;   makensis -DAPP_VERSION=0.13.0 installer.nsi
!ifndef APP_VERSION
  !define APP_VERSION "0.13.0"
!endif
!define APP_PUB "YiiOffice"
!define APP_EXE "YiiOffice.exe"
!define APP_UNINSTALL_KEY "YiiOffice"
!define APP_WEBSITE "https://yiioffice.com"
!define APP_EXTENSIONS ".docx,.xlsx,.pptx,.pdf,.md"

Name "${APP_NAME}"
OutFile "..\..\..\dist\${APP_NAME}_${APP_VERSION}_setup.exe"

; Install directory. A per-user install (RequestExecutionLevel user) has to
; live under the user profile: "$LOCALAPPDATA" is writable without elevation,
; whereas a fixed drive root (previously "D:\YiiOffice") fails on machines
; without that drive and needs rights the installer does not have.
InstallDir "$LOCALAPPDATA\${APP_NAME}"

; Remember the chosen directory across upgrades
InstallDirRegKey HKCU "Software\${APP_NAME}" ""

!include "MUI2.nsh"

; Pages. The MUI page macros must precede MUI_LANGUAGE, otherwise makensis
; warns that the language table is inserted after the pages.
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

; Sections
Section "MainSection"
  SetOutPath "$INSTDIR"
  File "..\..\..\build\bin\${APP_EXE}"

  ; ShellNew templates. These are tracked source files
  ; (build/shell-new/*, produced by generate-templates.mjs), so a missing one
  ; is a repository error and should fail the build instead of silently
  ; shipping an installer whose "New > Word Document" entry does not work.
  SetOutPath "$INSTDIR\shell-new"
  File "..\..\..\build\shell-new\blank.docx"
  File "..\..\..\build\shell-new\blank.xlsx"
  File "..\..\..\build\shell-new\blank.pptx"
  SetOutPath "$INSTDIR"

  ; File associations
  ; .docx
  WriteRegStr HKCU "Software\Classes\.docx" "" "YiiOffice.docx"
  WriteRegStr HKCU "Software\Classes\YiiOffice.docx" "" "Word Document"
  WriteRegStr HKCU "Software\Classes\YiiOffice.docx\DefaultIcon" "" "$INSTDIR\YiiOffice.exe,0"
  WriteRegStr HKCU "Software\Classes\YiiOffice.docx\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'

  ; .xlsx
  WriteRegStr HKCU "Software\Classes\.xlsx" "" "YiiOffice.xlsx"
  WriteRegStr HKCU "Software\Classes\YiiOffice.xlsx" "" "Excel Spreadsheet"
  WriteRegStr HKCU "Software\Classes\YiiOffice.xlsx\DefaultIcon" "" "$INSTDIR\YiiOffice.exe,0"
  WriteRegStr HKCU "Software\Classes\YiiOffice.xlsx\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'

  ; .pptx
  WriteRegStr HKCU "Software\Classes\.pptx" "" "YiiOffice.pptx"
  WriteRegStr HKCU "Software\Classes\YiiOffice.pptx" "" "PowerPoint Presentation"
  WriteRegStr HKCU "Software\Classes\YiiOffice.pptx\DefaultIcon" "" "$INSTDIR\YiiOffice.exe,0"
  WriteRegStr HKCU "Software\Classes\YiiOffice.pptx\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'

  ; .pdf
  WriteRegStr HKCU "Software\Classes\.pdf" "" "YiiOffice.pdf"
  WriteRegStr HKCU "Software\Classes\YiiOffice.pdf" "" "PDF Document"
  WriteRegStr HKCU "Software\Classes\YiiOffice.pdf\DefaultIcon" "" "$INSTDIR\YiiOffice.exe,0"
  WriteRegStr HKCU "Software\Classes\YiiOffice.pdf\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'

  ; .md
  WriteRegStr HKCU "Software\Classes\.md" "" "YiiOffice.md"
  WriteRegStr HKCU "Software\Classes\YiiOffice.md" "" "Markdown Document"
  WriteRegStr HKCU "Software\Classes\YiiOffice.md\DefaultIcon" "" "$INSTDIR\YiiOffice.exe,0"
  WriteRegStr HKCU "Software\Classes\YiiOffice.md\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'

  ; ShellNew - Right-click "New" context menu
  WriteRegStr HKCU "Software\Classes\.docx\ShellNew" "FileName" "$INSTDIR\shell-new\blank.docx"
  WriteRegStr HKCU "Software\Classes\.xlsx\ShellNew" "FileName" "$INSTDIR\shell-new\blank.xlsx"
  WriteRegStr HKCU "Software\Classes\.pptx\ShellNew" "FileName" "$INSTDIR\shell-new\blank.pptx"

  ; Uninstall info
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "Publisher" "${APP_PUB}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayIcon" '"$INSTDIR\YiiOffice.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "URLInfoAbout" "${APP_WEBSITE}"

  ; Install directory for recovery
  WriteRegStr HKCU "Software\${APP_NAME}" "" "$INSTDIR"

  ; Start menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  ; Uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; Uninstall section
Section "Uninstall"
  ; Stop running app using Taskkill
  nsExec::ExecToStack 'taskkill /IM ${APP_EXE} /T /F'
  Pop $0

  ; Remove file associations
  DeleteRegKey HKCU "Software\Classes\YiiOffice.docx"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.xlsx"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.pptx"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.pdf"
  DeleteRegKey HKCU "Software\Classes\YiiOffice.md"

  ; Remove ShellNew
  DeleteRegKey HKCU "Software\Classes\.docx\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.xlsx\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.pptx\ShellNew"

  ; Remove uninstall info
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${APP_NAME}"

  ; Remove files
  RMDir /r "$INSTDIR"
  RMDir "$SMPROGRAMS\${APP_NAME}"
SectionEnd

; Functions
Function .onInit
  InitPluginsDir
FunctionEnd
