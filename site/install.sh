#!/bin/sh
set -eu

APP_NAME="mdownreview"
GITHUB_REPO="dryotta/mdownreview"
INSTALL_DIR="$HOME/Applications"

main() {
  need_cmd curl
  need_cmd hdiutil
  need_cmd cp
  need_cmd rm
  need_cmd mktemp
  need_cmd xattr
  need_cmd ln
  need_cmd mkdir

  # Only macOS is supported
  OS="$(uname -s)"
  case "$OS" in
    Darwin) ;;
    *) err "This script only supports macOS. For Windows, use install.ps1." ;;
  esac

  # Detect architecture
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64)  ARCH_LABEL="arm64" ;;
    x86_64) ARCH_LABEL="arm64" ; say "Note: Intel Mac detected. Installing ARM64 build (runs via Rosetta 2)." ;;
    *) err "Unsupported architecture: $ARCH" ;;
  esac

  say "Fetching latest release..."
  TAG=$(curl -fsSL --proto '=https' --tlsv1.2 "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  [ -z "$TAG" ] && err "Could not determine latest release tag."
  VERSION="${TAG#v}"

  FILENAME="${APP_NAME}-${VERSION}-macos-${ARCH_LABEL}.dmg"
  URL="https://github.com/${GITHUB_REPO}/releases/download/${TAG}/${FILENAME}"

  TMPDIR_INSTALL="$(mktemp -d)"
  trap 'cleanup' EXIT

  say "Downloading ${FILENAME}..."
  curl -fSL --proto '=https' --tlsv1.2 --progress-bar -o "${TMPDIR_INSTALL}/${FILENAME}" "$URL"

  say "Mounting disk image..."
  MOUNT_POINT=$(hdiutil attach -nobrowse -readonly "${TMPDIR_INSTALL}/${FILENAME}" \
    | grep '/Volumes/' | sed 's/.*\(\/Volumes\/.*\)/\1/')
  [ -z "$MOUNT_POINT" ] && err "Failed to mount DMG."

  APP_PATH=$(find "$MOUNT_POINT" -maxdepth 1 -name "*.app" | head -1)
  [ -z "$APP_PATH" ] && { hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true; err "No .app found in DMG."; }

  mkdir -p "$INSTALL_DIR"
  APP_BASENAME="$(basename "$APP_PATH")"

  # Remove existing installation if present
  if [ -d "${INSTALL_DIR}/${APP_BASENAME}" ]; then
    say "Removing previous installation..."
    rm -rf "${INSTALL_DIR}/${APP_BASENAME}"
  fi

  say "Installing to ${INSTALL_DIR}/${APP_BASENAME}..."
  cp -R "$APP_PATH" "$INSTALL_DIR/"
  xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_BASENAME" 2>/dev/null || true

  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

  CLI_SRC="$INSTALL_DIR/$APP_BASENAME/Contents/MacOS/mdownreview-cli"

  install_symlink() {
    # $1 = target dir
    dir="$1"
    link="$dir/mdownreview-cli"
    if [ -e "$link" ] && [ ! -L "$link" ]; then
      say "  refusing to overwrite regular file at $link"
      return 1
    fi
    [ -L "$link" ] && rm -f "$link"
    mkdir -p "$dir" 2>/dev/null || return 1
    ln -s "$CLI_SRC" "$link" 2>/dev/null || return 1
    SYMLINK_PATH="$link"
    return 0
  }

  SYMLINK_PATH=""
  if [ -x "$CLI_SRC" ]; then
    if install_symlink "/usr/local/bin"; then
      say "  CLI symlinked at $SYMLINK_PATH"
    elif install_symlink "$HOME/.local/bin"; then
      say "  CLI symlinked at $SYMLINK_PATH"
      case ":${PATH:-}:" in
        *":$HOME/.local/bin:"*) ;;
        *) say "  ⚠ Add \$HOME/.local/bin to PATH to use 'mdownreview-cli' directly." ;;
      esac
    else
      say "  ⚠ Could not install CLI symlink. Run manually: ln -s \"$CLI_SRC\" ~/.local/bin/mdownreview-cli"
    fi
  else
    say "  ⚠ Embedded CLI not found at $CLI_SRC — older app bundle? Skipping symlink."
  fi

  say ""
  say "✓ ${APP_NAME} ${VERSION} installed to ${INSTALL_DIR}/${APP_BASENAME}"
  say "  Open it from ~/Applications or run:"
  say "    open \"${INSTALL_DIR}/${APP_BASENAME}\""
}

cleanup() {
  [ -d "${TMPDIR_INSTALL:-}" ] && rm -rf "$TMPDIR_INSTALL"
  # Attempt unmount in case of early exit
  [ -n "${MOUNT_POINT:-}" ] && hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
}

say() {
  printf '%s\n' "$@"
}

err() {
  say "error: $1" >&2
  exit 1
}

need_cmd() {
  if ! command -v "$1" > /dev/null 2>&1; then
    err "need '$1' (command not found)"
  fi
}

main "$@"
