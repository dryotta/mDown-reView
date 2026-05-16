; mdownreview NSIS hooks for issue #55
; - POSTINSTALL: add install dir to per-user PATH
; - PREUNINSTALL: cleanly remove PATH entry
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

; --- Helper: notify shell that HKCU\Environment changed --------------------
; ${MdrBroadcastEnvChange}
;   Broadcasts WM_SETTINGCHANGE("Environment") so Explorer (and other
;   well-behaved listeners) re-merge HKCU\Environment + HKLM\Environment
;   into their in-memory env block. New shells spawned afterwards inherit
;   the updated PATH without a logoff. Already-running shells keep their
;   inherited copy either way — that is a Windows process-model invariant,
;   not a broadcast issue.
;
;   Uses SendMessageTimeoutW with SMTO_ABORTIFHUNG (0x0002) so a single
;   hung neighbour window cannot stall the installer for the full timeout.
;   1 s per cooperative window is generous; Explorer / conhost /
;   Cmd Shell host all respond in milliseconds. The previous
;   `SendMessage … /TIMEOUT=5000` (which lowers to SMTO_NORMAL) made the
;   silent-install path sit on the "Installing" page for ~60 s on busy
;   desktops because Windows applies the timeout per non-responsive
;   top-level window when target = HWND_BROADCAST.
;
;   Mirrors `broadcast_environment_change` in
;   `src-tauri/src/commands/cli_shim/windows.rs`, which performs the
;   same broadcast from Rust when the user toggles "Add mdownreview-cli
;   to your PATH" in Settings. Keeping both writers symmetric is
;   important: the install-time and runtime paths must behave the same.
;
;   HWND_BROADCAST = 0xFFFF, WM_SETTINGCHANGE = 0x001A, SMTO_ABORTIFHUNG = 0x0002.
;   Scratch register $0 is clobbered.
!macro MdrBroadcastEnvChange
  System::Call 'user32::SendMessageTimeoutW(p 0xFFFF, i 0x001A, p 0, t "Environment", i 0x0002, i 1000, *p .r0)'
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
  ; Tell Explorer to re-read the env block so new shells inherit the
  ; updated PATH without a logoff. See MdrBroadcastEnvChange above for
  ; the SMTO_ABORTIFHUNG rationale.
  !insertmacro MdrBroadcastEnvChange

  ; File-association open-command override managed at runtime via IPC
  ; commands (commands/default_handler.rs).
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
  !insertmacro MdrBroadcastEnvChange

  ; File-association cleanup managed at runtime.
!macroend
