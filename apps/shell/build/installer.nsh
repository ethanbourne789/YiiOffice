; Keeps the shell-new template files for Office file associations.
; electron-builder compiles the script twice (the second pass, with
; BUILD_UNINSTALLER, only produces the uninstaller); an unreferenced function
; in either pass is a warning makensis treats as an error, hence the guards.
!include "WinMessages.nsh"
!include "StrFunc.nsh"

; -- Installation mode and default directory: per-user, D:\YiiOffice ----------
; The system drive is usually the tight one, so the wizard must offer
; D:\YiiOffice by default, and the "install for whom" page is pure friction for
; a per-user desktop product - it is suppressed further down.
;
; Setting $INSTDIR alone would not stick. An assisted install (oneClick: false)
; inserts multiUserUi.nsh's install-mode page, whose leave path calls
; setInstallModePerUser / setInstallModePerAllUsers and recomputes $INSTDIR
; from the registry InstallLocation, overwriting whatever .onInit set earlier.
; The only durable carrier for the default is that registry value, and preInit
; is the only hook that runs before initMultiUser reads it.
;
; preInit guards, all mandatory:
;  1. Write only when InstallLocation (HKCU and HKLM) is empty. An existing
;     installation - upgrade, reinstall, a directory the user picked before -
;     must keep its path, otherwise an upgrade installs into D:\YiiOffice and
;     leaves the old copy behind.
;  2. D: must be a fixed local volume (GetDriveType == 3). Without a D: drive,
;     or when D: is a CD-ROM / network share, keep electron-builder's default
;     (%LOCALAPPDATA%\Programs\YiiOffice); unpacking into a dead path fails
;     outright.
;  3. Skip the whole thing under BUILD_UNINSTALLER. That packaging pass really
;     executes .onInit on the build machine, so writing there would put
;     D:\YiiOffice into the packager's own registry.
;
; The value goes to HKCU because installs are per-user (customInstallMode
; below). The uninstaller needs none of this: it reads the real path from its
; own uninstall entry.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ; The NSIS stub is a 32-bit process, while multiUser.nsh reads
    ; InstallLocation after check64BitAndSetRegView has switched to the 64-bit
    ; view. Writing without switching first lands in WOW6432Node, where the
    ; installer never looks.
    SetRegView 64
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 == ""
      ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $0 == ""
        ; The root path must be a literal: System::Call drops a trailing
        ; backslash when the argument comes from a variable ("D:\" in $0
        ; arrives as "D:" and GetDriveType then answers DRIVE_NO_ROOT_DIR).
        System::Call 'kernel32::GetDriveType(t "D:\") i.r1'
        ${If} $1 == 3
          WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\YiiOffice"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !endif
!macroend

; Hide the "install for whom" page. multiUserUi.nsh's install-mode page aborts
; itself when $isForceCurrentInstall is set, and the abort path runs
; setInstallModePerUser - so a fresh install becomes a per-user install with no
; mode page and no UAC prompt, and the directory page right after it already
; shows D:\YiiOffice (seeded by preInit).
;
; The one case that keeps the page: a machine-wide installation from an earlier
; release. Forcing per-user over it would leave the old copy behind and split
; the app into two installations, so the choice stays available there. The
; documented /allusers switch is evaluated before this flag and keeps working.
;
; Both variables and this hook only exist for assisted, non-perMachine builds
; (multiUserUi.nsh is skipped otherwise), and the hook is only inserted from
; there, so nothing here compiles for oneClick / perMachine configurations.
!macro customInstallMode
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

; Scope templates to our ProgIDs (electron-builder uses fileAssociations.name).
; A shared .ext\ShellNew would overwrite Office/WPS templates. OOXML files
; must be copied from valid packages, never created with NullFile.
!macro YiiOfficeRegisterShellNew EXT PROGID
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew" "FileName" "$INSTDIR\resources\shell-new\blank.${EXT}"
!macroend

!macro YiiOfficeUnregisterShellNew EXT PROGID
  ; Only remove our own registration, including when uninstalling for an update.
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew" "FileName"
  ${If} $0 == "$INSTDIR\resources\shell-new\blank.${EXT}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro YiiOfficeRegisterShellNew "docx" "Word Document"
  !insertmacro YiiOfficeRegisterShellNew "xlsx" "Excel Workbook"
  !insertmacro YiiOfficeRegisterShellNew "pptx" "PowerPoint Presentation"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro customUnInstall
  Push $0
  !insertmacro YiiOfficeUnregisterShellNew "docx" "Word Document"
  !insertmacro YiiOfficeUnregisterShellNew "xlsx" "Excel Workbook"
  !insertmacro YiiOfficeUnregisterShellNew "pptx" "PowerPoint Presentation"
  Pop $0
  !insertmacro UPDATEFILEASSOC
!macroend

!ifndef BUILD_UNINSTALLER
!endif

!ifdef BUILD_UNINSTALLER
!endif
