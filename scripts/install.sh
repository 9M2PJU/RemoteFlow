#!/usr/bin/env bash
# Universal 1-Liner Installer for RemoteFlow (Linux x86_64)
# Supports:
#   - Rootless user-space portable installation (~/.local/bin/remoteflow + XDG desktop entry)
#   - System package installation (--system) for Debian/Ubuntu (.deb), Fedora/RHEL/openSUSE (.rpm), and Arch Linux (pacman)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/9M2PJU/RemoteFlow/main/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/9M2PJU/RemoteFlow/main/scripts/install.sh | bash -s -- --system
set -euo pipefail

REPO_PRIMARY="${REMOTEFLOW_REPO:-9M2PJU/RemoteFlow}"
REPO_UPSTREAM="jacek-nikiel/RemoteFlow"
INSTALL_MODE="user" # "user" (default rootless portable) or "system"
INSTALL_DEPS="auto"

usage() {
  cat <<EOF
RemoteFlow Universal Linux Installer

Usage:
  bash install.sh [OPTIONS]

Options:
  --user          Install portable binary to ~/.local/bin with desktop icon (default, no root required for app)
  --system        Install system-wide (/usr/bin) using native package manager (.deb, .rpm, or pacman)
  --no-deps       Skip installing system runtime dependencies
  --repo OWNER/R  GitHub repository to fetch releases from (default: $REPO_PRIMARY, fallback: $REPO_UPSTREAM)
  -h, --help      Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) INSTALL_MODE="user"; shift ;;
    --system) INSTALL_MODE="system"; shift ;;
    --no-deps) INSTALL_DEPS="no"; shift ;;
    --repo) REPO_PRIMARY="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done

ARCH="$(uname -m)"
if [[ "$ARCH" != "x86_64" && "$ARCH" != "amd64" ]]; then
  printf 'Error: RemoteFlow Linux prebuilt binaries currently support x86_64 (detected: %s).\n' "$ARCH" >&2
  exit 1
fi

run_sudo() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    printf 'Warning: sudo not found; cannot run: %s\n' "$*" >&2
    return 1
  fi
}

install_runtime_deps() {
  [[ "$INSTALL_DEPS" == "no" ]] && return 0
  if command -v pacman >/dev/null 2>&1; then
    printf '==> Checking Arch Linux runtime dependencies...\n'
    run_sudo pacman -S --needed --noconfirm \
      webkit2gtk-4.1 gtk3 openssl libx11 dbus zlib ca-certificates xdg-utils hicolor-icon-theme || true
  elif command -v apt-get >/dev/null 2>&1; then
    printf '==> Checking Debian/Ubuntu runtime dependencies...\n'
    run_sudo apt-get update -qq || true
    if apt-cache show libgtk-3-0t64 >/dev/null 2>&1; then
      run_sudo apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-0 libgtk-3-0t64 libssl3t64 libx11-6 libdbus-1-3 zlib1g ca-certificates xdg-utils || true
    else
      run_sudo apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-0 libgtk-3-0 libssl3 libx11-6 libdbus-1-3 zlib1g ca-certificates xdg-utils || true
    fi
  elif command -v dnf >/dev/null 2>&1; then
    printf '==> Checking Fedora/RHEL runtime dependencies...\n'
    run_sudo dnf install -y webkit2gtk4.1 gtk3 openssl-libs libX11 dbus-libs zlib ca-certificates xdg-utils || true
  fi
}

fetch_latest_release_json() {
  local repo="$1"
  curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" 2>/dev/null
}

printf '==> Finding latest RemoteFlow release...\n'
RELEASE_REPO="$REPO_PRIMARY"
RELEASE_JSON="$(fetch_latest_release_json "$RELEASE_REPO" || true)"
if [[ -z "$RELEASE_JSON" ]] || ! grep -q '"tag_name"' <<<"$RELEASE_JSON"; then
  RELEASE_REPO="$REPO_UPSTREAM"
  RELEASE_JSON="$(fetch_latest_release_json "$RELEASE_REPO" || true)"
fi

if [[ -z "$RELEASE_JSON" ]] || ! grep -q '"tag_name"' <<<"$RELEASE_JSON"; then
  printf 'Error: Could not fetch latest release metadata from GitHub (%s or %s).\n' "$REPO_PRIMARY" "$REPO_UPSTREAM" >&2
  exit 1
fi

TAG="$(grep -m1 '"tag_name"' <<<"$RELEASE_JSON" | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
VERSION="${TAG#v}"
printf '==> Latest version: %s (from %s)\n' "$VERSION" "$RELEASE_REPO"

extract_asset_url() {
  local pattern="$1"
  grep -oE "\"browser_download_url\": *\"[^\"]*${pattern}\"" <<<"$RELEASE_JSON" \
    | head -n1 \
    | sed -E 's/.*"([^"]+)"$/\1/'
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ "$INSTALL_MODE" == "system" ]]; then
  if command -v apt-get >/dev/null 2>&1; then
    DEB_URL="$(extract_asset_url '_amd64\.deb')"
    if [[ -n "$DEB_URL" ]]; then
      printf '==> Downloading %s...\n' "$DEB_URL"
      curl -fL --progress-bar "$DEB_URL" -o "$TMP_DIR/remoteflow.deb"
      printf '==> Installing .deb package...\n'
      run_sudo apt-get update -qq || true
      run_sudo apt-get install -y "$TMP_DIR/remoteflow.deb"
      printf '==> RemoteFlow %s installed to /usr/bin/remoteflow!\n' "$VERSION"
      exit 0
    fi
  elif command -v dnf >/dev/null 2>&1; then
    RPM_URL="$(extract_asset_url '\.x86_64\.rpm')"
    if [[ -n "$RPM_URL" ]]; then
      printf '==> Downloading %s...\n' "$RPM_URL"
      curl -fL --progress-bar "$RPM_URL" -o "$TMP_DIR/remoteflow.rpm"
      printf '==> Installing .rpm package...\n'
      run_sudo dnf install -y "$TMP_DIR/remoteflow.rpm"
      printf '==> RemoteFlow %s installed to /usr/bin/remoteflow!\n' "$VERSION"
      exit 0
    fi
  elif command -v pacman >/dev/null 2>&1; then
    ZST_URL="$(extract_asset_url '\.pkg\.tar\.zst')"
    if [[ -n "$ZST_URL" ]]; then
      printf '==> Downloading Arch package %s...\n' "$ZST_URL"
      curl -fL --progress-bar "$ZST_URL" -o "$TMP_DIR/remoteflow-${VERSION}-1-x86_64.pkg.tar.zst"
      printf '==> Installing .pkg.tar.zst package via pacman -U...\n'
      run_sudo pacman -U --needed "$TMP_DIR/remoteflow-${VERSION}-1-x86_64.pkg.tar.zst"
      printf '==> RemoteFlow %s installed via pacman!\n' "$VERSION"
      exit 0
    fi
  fi

  # System install for Arch Linux or fallback distro
  install_runtime_deps
  PORTABLE_URL="$(extract_asset_url '_amd64-portable')"
  if [[ -z "$PORTABLE_URL" ]]; then
    printf 'Error: Could not find Linux portable binary in release %s.\n' "$TAG" >&2
    exit 1
  fi
  printf '==> Downloading RemoteFlow binary (%s)...\n' "$PORTABLE_URL"
  curl -fL --progress-bar "$PORTABLE_URL" -o "$TMP_DIR/remoteflow"
  ICON_URL="https://raw.githubusercontent.com/${RELEASE_REPO}/${TAG}/src-tauri/icons/icon.png"
  curl -fsSL "$ICON_URL" -o "$TMP_DIR/remoteflow.png" || \
    curl -fsSL "https://raw.githubusercontent.com/${REPO_UPSTREAM}/main/src-tauri/icons/icon.png" -o "$TMP_DIR/remoteflow.png"

  printf '==> Installing system-wide into /usr/bin/remoteflow...\n'
  run_sudo install -Dm755 "$TMP_DIR/remoteflow" /usr/bin/remoteflow
  run_sudo install -Dm644 "$TMP_DIR/remoteflow.png" /usr/share/icons/hicolor/512x512/apps/remoteflow.png
  cat > "$TMP_DIR/remoteflow.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RemoteFlow
Comment=SSH, SFTP and RDP connection manager
Exec=/usr/bin/remoteflow
Icon=remoteflow
Terminal=false
Categories=Development;Network;
StartupWMClass=remoteflow
EOF
  run_sudo install -Dm644 "$TMP_DIR/remoteflow.desktop" /usr/share/applications/remoteflow.desktop
  printf '==> RemoteFlow %s installed system-wide (/usr/bin/remoteflow)!\n' "$VERSION"
  exit 0
fi

# User-space installation (~/.local/bin/remoteflow)
install_runtime_deps

PORTABLE_URL="$(extract_asset_url '_amd64-portable')"
if [[ -z "$PORTABLE_URL" ]]; then
  printf 'Error: Could not find _amd64-portable asset in release %s.\n' "$TAG" >&2
  exit 1
fi

BIN_DIR="${HOME}/.local/bin"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
ICON_DEST="${DATA_HOME}/icons/hicolor/512x512/apps/remoteflow.png"
DESKTOP_DEST="${DATA_HOME}/applications/remoteflow.desktop"

mkdir -p "$BIN_DIR" "$(dirname "$ICON_DEST")" "$(dirname "$DESKTOP_DEST")"

printf '==> Downloading RemoteFlow %s to %s/remoteflow...\n' "$VERSION" "$BIN_DIR"
curl -fL --progress-bar "$PORTABLE_URL" -o "$TMP_DIR/remoteflow"
install -m755 "$TMP_DIR/remoteflow" "$BIN_DIR/remoteflow"

ICON_URL="https://raw.githubusercontent.com/${RELEASE_REPO}/${TAG}/src-tauri/icons/icon.png"
if ! curl -fsSL "$ICON_URL" -o "$ICON_DEST" 2>/dev/null; then
  curl -fsSL "https://raw.githubusercontent.com/${REPO_UPSTREAM}/main/src-tauri/icons/icon.png" -o "$ICON_DEST"
fi

cat > "$DESKTOP_DEST" <<EOF
[Desktop Entry]
Type=Application
Name=RemoteFlow
Comment=SSH, SFTP and RDP connection manager
Exec="$BIN_DIR/remoteflow"
Icon=$ICON_DEST
Terminal=false
Categories=Development;Network;
StartupWMClass=remoteflow
EOF
chmod 644 "$DESKTOP_DEST"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${DATA_HOME}/applications" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${DATA_HOME}/icons/hicolor" >/dev/null 2>&1 || true
fi

printf '\n✓ RemoteFlow %s installed to %s/remoteflow\n' "$VERSION" "$BIN_DIR"
printf '✓ Desktop shortcut created at %s\n' "$DESKTOP_DEST"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  printf 'ℹ️ Note: %s is not in your PATH. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile.\n' "$BIN_DIR"
fi
