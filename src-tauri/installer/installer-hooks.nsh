; mdownreview NSIS hooks for issue #55
; - POSTINSTALL: add install dir to per-user PATH and register folder context menu
; - PREUNINSTALL: cleanly remove PATH entry and registry keys
; All operations target HKCU only (per-user; no UAC).
;
; Requires the EnVar NSIS plugin (bundled with Tauri's NSIS distribution
; under nsis/Plugins/x86-unicode/EnVar.dll). EnVar handles dedupe, the
; 8191-char registry length cap, and the WM_SETTINGCHANGE broadcast that
; tells the shell to pick up the new PATH without a reboot.

!macro NSIS_HOOK_POSTINSTALL
  ; --- Add $INSTDIR to per-user PATH (HKCU\Environment) ---
  EnVar::SetHKCU
  EnVar::AddValue "PATH" "$INSTDIR"
  Pop $0  ; 0 on success
  ; Continue regardless; failure is surfaced in the install log.

  ; --- Register folder context menu: "Open with mdownreview" ---
  WriteRegStr HKCU "Software\Classes\Directory\shell\Open with mdownreview" "" "Open with mdownreview"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Open with mdownreview" "Icon" "$INSTDIR\mdownreview.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Open with mdownreview\command" "" '"$INSTDIR\mdownreview.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Open with mdownreview" "" "Open with mdownreview"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Open with mdownreview" "Icon" "$INSTDIR\mdownreview.exe"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Open with mdownreview\command" "" '"$INSTDIR\mdownreview.exe" "%V"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; --- Remove $INSTDIR from per-user PATH ---
  EnVar::SetHKCU
  EnVar::DeleteValue "PATH" "$INSTDIR"
  Pop $0

  ; --- Remove folder context menu keys ---
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Open with mdownreview"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Open with mdownreview"
!macroend
