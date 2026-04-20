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
  TAG=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  [ -z "$TAG" ] && err "Could not determine latest release tag."
  VERSION="${TAG#v}"

  FILENAME="${APP_NAME}-${VERSION}-macos-${ARCH_LABEL}.dmg"
  URL="https://github.com/${GITHUB_REPO}/releases/download/${TAG}/${FILENAME}"

  TMPDIR_INSTALL="$(mktemp -d)"
  trap 'cleanup' EXIT

  say "Downloading ${FILENAME}..."
  curl -fSL --progress-bar -o "${TMPDIR_INSTALL}/${FILENAME}" "$URL"

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

  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

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
