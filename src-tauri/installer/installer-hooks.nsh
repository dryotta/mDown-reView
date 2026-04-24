; mdownreview NSIS hooks for issue #55
; - POSTINSTALL: add install dir to per-user PATH and register folder context menu
; - PREUNINSTALL: cleanly remove PATH entry and registry keys
; All operations target HKCU only (per-user; no UAC).
;
; Pure stock NSIS — no plugins required.
; PATH mutation uses ReadRegStr / WriteRegExpandStr on HKCU\Environment, with
; a WM_SETTINGCHANGE broadcast so already-running shells pick up the change
; without a logoff. WriteRegExpandStr (REG_EXPAND_SZ) is used because user PATH
; values commonly contain unexpanded %VARS%.

!include "LogicLib.nsh"
!include "WinMessages.nsh"

; --- Helper: filter ;-separated PATH tokens ---------------------------------
; ${MdrFilterPath} INPUT TARGET OUTVAR
;   Walk the ;-separated string INPUT and copy every non-empty token into
;   OUTVAR, except tokens that compare equal (case-insensitive, NSIS default)
;   to TARGET. Runs of ';' are collapsed because empty tokens are dropped.
;   Used by both hooks: POSTINSTALL calls it to dedupe before appending,
;   PREUNINSTALL calls it to strip the install dir on uninstall.
;   Scratch registers $R5..$R9 are clobbered (caller must not depend on them).
!macro MdrFilterPath INPUT TARGET OUTVAR
  StrCpy $R5 "${INPUT}"   ; remaining input
  StrCpy $R6 ""           ; output accumulator
  ${Do}
    ${If} $R5 == ""
      ${ExitDo}
    ${EndIf}
    ; Find next ';' in $R5; token = substring up to it (or whole remainder).
    StrCpy $R7 0
    StrCpy $R8 ""
    ${Do}
      StrCpy $R9 $R5 1 $R7
      ${If} $R9 == ""
        StrCpy $R8 $R5
        StrCpy $R5 ""
        ${ExitDo}
      ${EndIf}
      ${If} $R9 == ";"
        StrCpy $R8 $R5 $R7
        IntOp $R7 $R7 + 1
        StrCpy $R5 $R5 "" $R7
        ${ExitDo}
      ${EndIf}
      IntOp $R7 $R7 + 1
    ${Loop}
    ; Append token unless empty or matches target (== is case-insensitive).
    ${If} $R8 != ""
    ${AndIf} $R8 != "${TARGET}"
      ${If} $R6 == ""
        StrCpy $R6 $R8
      ${Else}
        StrCpy $R6 "$R6;$R8"
      ${EndIf}
    ${EndIf}
  ${Loop}
  StrCpy ${OUTVAR} $R6
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; --- Add $INSTDIR to per-user PATH (HKCU\Environment) ---
  ; Read existing PATH; if missing, ReadRegStr leaves $R0 empty.
  ClearErrors
  ReadRegStr $R0 HKCU "Environment" "Path"
  ${If} ${Errors}
    StrCpy $R0 ""
  ${EndIf}
  ; Dedupe: drop any existing $INSTDIR token, then append fresh at the end.
  !insertmacro MdrFilterPath "$R0" "$INSTDIR" $R1
  ${If} $R1 == ""
    StrCpy $R2 "$INSTDIR"
  ${Else}
    StrCpy $R2 "$R1;$INSTDIR"
  ${EndIf}
  WriteRegExpandStr HKCU "Environment" "Path" "$R2"
  ; Tell already-running shells to refresh their environment (no logoff).
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

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
  ClearErrors
  ReadRegStr $R0 HKCU "Environment" "Path"
  ${If} ${Errors}
    StrCpy $R0 ""
  ${EndIf}
  !insertmacro MdrFilterPath "$R0" "$INSTDIR" $R1
  ${If} $R1 == ""
    ; Nothing left — drop the value entirely rather than writing an empty string.
    DeleteRegValue HKCU "Environment" "Path"
  ${Else}
    WriteRegExpandStr HKCU "Environment" "Path" "$R1"
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; --- Remove folder context menu keys ---
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Open with mdownreview"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Open with mdownreview"
!macroend
