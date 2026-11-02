; YiiOffice Windows Installer
; Per-user installation, no UAC required
;
; This file is the installer the build pipeline actually compiles:
;   task package:windows  ->  makensis build/windows/nsis/installer.nsi
; Everything it needs lives in the repository (app binary, ShellNew
; templates, icon), so a fresh clone can produce the same installer.

Unicode true
RequestExecutionLevel user
; SOLID packs all files into one LZMA block; with a single large exe it also
; compresses marginally better than the streaming mode.
SetCompressor /SOLID lzma

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
; WebView2 Evergreen Runtime registration (same check as Edge's own installer).
!define WEBVIEW2_CLIENT_KEY "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WEBVIEW2_INSTALL_URL "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

Name "${APP_NAME}"
OutFile "..\..\..\dist\${APP_NAME}_${APP_VERSION}_setup.exe"

; Install directory: default to D:\YiiOffice. Non-system drive roots are
; writable by standard users, so this works with RequestExecutionLevel user;
; .onInit falls back to $LOCALAPPDATA on machines without a D: drive.
InstallDir "D:\${APP_NAME}"

; Remember the chosen directory across upgrades
InstallDirRegKey HKCU "Software\${APP_NAME}" ""

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "StrFunc.nsh"
${Using:StrFunc} StrStr

; Installer/uninstaller icon (setup exe shows the app logo)
!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"

; Pages. The MUI page macros must precede MUI_LANGUAGE, otherwise makensis
; warns that the language table is inserted after the pages.
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

; Finish page: a checked "Run YiiOffice" checkbox launches the app on Close
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "$(RUN_APP_TEXT)"
!define MUI_FINISHPAGE_RUN_CHECKED
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

LangString RUN_APP_TEXT ${LANG_ENGLISH} "Run ${APP_NAME}"
LangString RUN_APP_TEXT ${LANG_SIMPCHINESE} "运行 ${APP_NAME}"

LangString APP_RUNNING_TEXT ${LANG_ENGLISH} "${APP_NAME} is currently running. Setup must close it before updating; any unsaved document will be lost. Continue?"
LangString APP_RUNNING_TEXT ${LANG_SIMPCHINESE} "${APP_NAME} 正在运行。安装程序需要先关闭它才能继续更新，未保存的文档将会丢失。是否继续？"

LangString APP_STILL_RUNNING_TEXT ${LANG_ENGLISH} "${APP_NAME} could not be closed automatically. Please close it manually and run Setup again, otherwise the update may fail."
LangString APP_STILL_RUNNING_TEXT ${LANG_SIMPCHINESE} "无法自动关闭 ${APP_NAME}。请手动退出后重新运行安装程序，否则更新可能失败。"

LangString WEBVIEW2_MISSING_TEXT ${LANG_ENGLISH} "WebView2 Runtime was not detected. ${APP_NAME} needs it to display its interface; without it the app will not start. Open the download page now?"
LangString WEBVIEW2_MISSING_TEXT ${LANG_SIMPCHINESE} "未检测到 WebView2 运行时。${APP_NAME} 需要它来显示界面，缺失时应用将无法启动。是否现在打开下载页面？"

; --- file association helpers ------------------------------------------------
; Strategy (mirrors internal/host/fileassoc.go): register our ProgIDs, list
; them in each extension's OpenWithProgids, and publish Default Programs
; Capabilities so the user can pick ${APP_NAME} in Windows settings. The
; installer NEVER overwrites the extension's default association.
!macro RegisterAssocOne EXT
  WriteRegStr HKCU "Software\Classes\${APP_NAME}${EXT}" "" "${APP_NAME} Document"
  WriteRegStr HKCU "Software\Classes\${APP_NAME}${EXT}" "FriendlyTypeName" "${APP_NAME} Document"
  WriteRegStr HKCU "Software\Classes\${APP_NAME}${EXT}\DefaultIcon" "" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "Software\Classes\${APP_NAME}${EXT}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\${EXT}\OpenWithProgids" "${APP_NAME}${EXT}" ""
  WriteRegStr HKCU "Software\${APP_NAME}\Capabilities\FileAssociations" "${EXT}" "${APP_NAME}${EXT}"
!macroend

; Remember the default handler that belonged to ANOTHER application before
; the first YiiOffice install, so uninstall can give it back. A default that
; already points at us (legacy installers set it) is not worth remembering,
; and an existing backup is never overwritten by later upgrades.
!macro BackupDefaultOne EXT
  ReadRegStr $0 HKCU "Software\Classes\${EXT}" ""
  ReadRegStr $1 HKCU "Software\${APP_NAME}\AssocBackup\${EXT}" ""
  ${If} $1 == ""
  ${AndIf} $0 != ""
  ${AndIf} $0 != "${APP_NAME}${EXT}"
    WriteRegStr HKCU "Software\${APP_NAME}\AssocBackup\${EXT}" "" "$0"
  ${EndIf}
!macroend

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

  ; File associations: ProgID + OpenWithProgids + Capabilities only. The
  ; default handler is left to the user (Settings > Default apps).
  !insertmacro RegisterAssocOne ".docx"
  !insertmacro RegisterAssocOne ".xlsx"
  !insertmacro RegisterAssocOne ".pptx"
  !insertmacro RegisterAssocOne ".pdf"
  !insertmacro RegisterAssocOne ".md"

  ; Default Programs identity (per-user registration)
  WriteRegStr HKCU "Software\${APP_NAME}\Capabilities" "ApplicationName" "${APP_NAME}"
  WriteRegStr HKCU "Software\${APP_NAME}\Capabilities" "ApplicationDescription" "${APP_NAME} desktop office suite"
  WriteRegStr HKCU "Software\${APP_NAME}\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXE},0"

  ; Back up third-party defaults before anything else touches the classes
  !insertmacro BackupDefaultOne ".docx"
  !insertmacro BackupDefaultOne ".xlsx"
  !insertmacro BackupDefaultOne ".pptx"
  !insertmacro BackupDefaultOne ".pdf"
  !insertmacro BackupDefaultOne ".md"

  ; ShellNew - Right-click "New" context menu
  WriteRegStr HKCU "Software\Classes\.docx\ShellNew" "FileName" "$INSTDIR\shell-new\blank.docx"
  WriteRegStr HKCU "Software\Classes\.xlsx\ShellNew" "FileName" "$INSTDIR\shell-new\blank.xlsx"
  WriteRegStr HKCU "Software\Classes\.pptx\ShellNew" "FileName" "$INSTDIR\shell-new\blank.pptx"

  ; Uninstall info
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "Publisher" "${APP_PUB}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "DisplayIcon" '"$INSTDIR\${APP_EXE}"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}" "URLInfoAbout" "${APP_WEBSITE}"

  ; Install directory for recovery
  WriteRegStr HKCU "Software\${APP_NAME}" "" "$INSTDIR"

  ; Start menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  ; Desktop shortcut
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  ; AppUserModelID: NSIS's CreateShortCut cannot set the AUMID on the .lnk
  ; property store, and a registry-only "AUMID" would be a fake that Windows
  ; ignores for taskbar grouping. The correct fix is one line in the Go
  ; process (SetCurrentProcessExplicitAppUserModelID) — tracked as a TODO in
  ; internal/platform; intentionally not pseudo-implemented here.

  ; Uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; Uninstall helpers: remove our OpenWithProgids entry and ProgID, then give
; the default handler back — but ONLY while the default still points at us,
; so a choice the user made later is never overwritten.
!macro UnregisterAssocOne EXT
  DeleteRegValue HKCU "Software\Classes\${EXT}\OpenWithProgids" "${APP_NAME}${EXT}"
  DeleteRegKey HKCU "Software\Classes\${APP_NAME}${EXT}"
  ReadRegStr $0 HKCU "Software\Classes\${EXT}" ""
  ${If} $0 == "${APP_NAME}${EXT}"
    ReadRegStr $1 HKCU "Software\${APP_NAME}\AssocBackup\${EXT}" ""
    ${If} $1 == ""
      ; Nothing to restore (legacy installers had taken the default without a
      ; backup): clear the dangling pointer instead of leaving a broken one.
      DeleteRegValue HKCU "Software\Classes\${EXT}" ""
    ${Else}
      WriteRegStr HKCU "Software\Classes\${EXT}" "" "$1"
    ${EndIf}
  ${EndIf}
!macroend

; Uninstall section
Section "Uninstall"
  ; Stop running app using Taskkill
  nsExec::ExecToStack 'taskkill /IM ${APP_EXE} /T /F'
  Pop $0
  Pop $1

  ; Remove file associations (and restore backed-up defaults)
  !insertmacro UnregisterAssocOne ".docx"
  !insertmacro UnregisterAssocOne ".xlsx"
  !insertmacro UnregisterAssocOne ".pptx"
  !insertmacro UnregisterAssocOne ".pdf"
  !insertmacro UnregisterAssocOne ".md"

  ; Remove ShellNew
  DeleteRegKey HKCU "Software\Classes\.docx\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.xlsx\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.pptx\ShellNew"

  ; Remove uninstall info + app key (also carries Capabilities and AssocBackup)
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${APP_NAME}\AssocBackup"
  DeleteRegKey HKCU "Software\${APP_NAME}\Capabilities"
  DeleteRegKey HKCU "Software\${APP_NAME}"

  ; Remove desktop shortcut
  Delete "$DESKTOP\${APP_NAME}.lnk"

  ; Remove files
  RMDir /r "$INSTDIR"
  RMDir "$SMPROGRAMS\${APP_NAME}"
SectionEnd

; A running instance locks the exe and makes the overwrite step fail. Detect
; it with tasklist, warn before killing (interactive only; silent installs
; kill without asking), then wait for the process to actually disappear.
Function StopRunningInstance
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq ${APP_EXE}" /NH'
  Pop $0
  Pop $1
  ${StrStr} $0 $1 "${APP_EXE}"
  StrCmp $0 "" stop_done
  ${IfNot} ${Silent}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(APP_RUNNING_TEXT)" IDCANCEL stop_abort
  ${EndIf}
  IntOp $R6 0 + 0
stop_try:
  nsExec::ExecToStack 'taskkill /IM "${APP_EXE}" /T /F'
  Pop $0
  Pop $1
  Sleep 400
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq ${APP_EXE}" /NH'
  Pop $0
  Pop $1
  ${StrStr} $0 $1 "${APP_EXE}"
  StrCmp $0 "" stop_done
  IntOp $R6 $R6 + 1
  IntCmp $R6 10 stop_giveup stop_giveup stop_try
stop_giveup:
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(APP_STILL_RUNNING_TEXT)"
  ${EndIf}
  ; Continue anyway: the File step will surface a clear error if the exe is
  ; still locked.
  Goto stop_done
stop_abort:
  Abort
stop_done:
FunctionEnd

; The app cannot render without the WebView2 Evergreen Runtime. Warn and
; offer the download page, but never block the rest of the install — the
; runtime may be installed later or arrive via Windows Update.
Function CheckWebView2
  ReadRegStr $0 HKLM "${WEBVIEW2_CLIENT_KEY}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${WEBVIEW2_CLIENT_KEY}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "$(WEBVIEW2_MISSING_TEXT)" IDYES wv_open
      Goto wv_done
wv_open:
      ExecShell "open" "${WEBVIEW2_INSTALL_URL}"
wv_done:
    ${EndIf}
  ${EndIf}
FunctionEnd

; Functions
Function .onInit
  InitPluginsDir
  ; No D: drive (or not writable) -> fall back to the per-user profile dir
  ${IfNot} ${FileExists} "D:\*.*"
    StrCpy $INSTDIR "$LOCALAPPDATA\${APP_NAME}"
  ${EndIf}
  Call StopRunningInstance
  Call CheckWebView2
FunctionEnd
