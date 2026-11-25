#!/usr/bin/env bash
# Dedicated Arch Linux / CachyOS / Manjaro Installer for RemoteFlow (.pkg.tar.zst)
# Supports:
#   --zst       Build/download native Arch package (.pkg.tar.zst) and install via `pacman -U` (default)
#   --source    Compile from source and build/install .pkg.tar.zst via `makepkg -si`
#   --build-only Build remoteflow-<ver>-1-x86_64.pkg.tar.zst in the current directory without installing
#   --with-rdp  Also install optional FreeRDP, XWayland, clipboard, and file picker packages
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_PRIMARY="${REMOTEFLOW_REPO:-9M2PJU/RemoteFlow}"
REPO_UPSTREAM="jacek-nikiel/RemoteFlow"

MODE="zst"
WITH_OPTIONAL="no"
OUT_DIR="$(pwd)"

usage() {
  cat <<EOF
RemoteFlow Arch Linux Package Installer (.pkg.tar.zst)

Usage:
  bash scripts/install-arch.sh [OPTIONS]

Options:
  --zst          Download or build native .pkg.tar.zst package and install via 'sudo pacman -U' (default)
  --source       Compile from source and build/install .pkg.tar.zst via 'makepkg -si'
  --build-only   Only generate remoteflow-<version>-1-x86_64.pkg.tar.zst in the current directory
  --with-rdp     Also install optional packages (freerdp, xorg-xwayland, zenity, wl-clipboard, xclip)
  -h, --help     Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zst|--bin) MODE="zst"; shift ;;
    --source) MODE="source"; shift ;;
    --build-only) MODE="build-only"; shift ;;
    --with-rdp) WITH_OPTIONAL="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ "$MODE" != "build-only" ]] && ! command -v pacman >/dev/null 2>&1; then
  printf 'Error: pacman not found. Use --build-only to build the .pkg.tar.zst package on a non-Arch system.\n' >&2
  exit 1
fi

if [[ "$MODE" == "source" ]]; then
  printf '==> Building and installing RemoteFlow (.pkg.tar.zst) from source via makepkg...\n'
  WORK_DIR="$(mktemp -d)"
  trap 'rm -rf "$WORK_DIR"' EXIT
  cp "$REPO_ROOT/packaging/aur/remoteflow-git/PKGBUILD" "$WORK_DIR/PKGBUILD"
  (
    cd "$WORK_DIR"
    PKGEXT='.pkg.tar.zst' makepkg -si --needed
  )
  if [[ "$WITH_OPTIONAL" == "yes" ]]; then
    sudo pacman -S --needed freerdp xorg-xwayland which zenity wl-clipboard xclip openssh
  fi
  printf '✓ RemoteFlow .pkg.tar.zst built and installed via pacman!\n'
  exit 0
fi

# Fetch latest release info to either download .pkg.tar.zst directly or wrap the prebuilt binary into a .pkg.tar.zst
fetch_latest_release_json() {
  curl -fsSL "https://api.github.com/repos/$1/releases/latest" 2>/dev/null
}

RELEASE_REPO="$REPO_PRIMARY"
RELEASE_JSON="$(fetch_latest_release_json "$RELEASE_REPO" || true)"
if [[ -z "$RELEASE_JSON" ]] || ! grep -q '"tag_name"' <<<"$RELEASE_JSON"; then
  RELEASE_REPO="$REPO_UPSTREAM"
  RELEASE_JSON="$(fetch_latest_release_json "$RELEASE_REPO" || true)"
fi

if [[ -z "$RELEASE_JSON" ]] || ! grep -q '"tag_name"' <<<"$RELEASE_JSON"; then
  printf 'Error: Could not fetch latest release metadata from GitHub.\n' >&2
  exit 1
fi

TAG="$(grep -m1 '"tag_name"' <<<"$RELEASE_JSON" | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
VERSION="${TAG#v}"

extract_asset_url() {
  local pattern="$1"
  grep -oE "\"browser_download_url\": *\"[^\"]*${pattern}\"" <<<"$RELEASE_JSON" \
    | head -n1 \
    | sed -E 's/.*"([^"]+)"$/\1/'
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PKG_FILE="$TMP_DIR/remoteflow-${VERSION}-1-x86_64.pkg.tar.zst"
ZST_URL="$(extract_asset_url '\.pkg\.tar\.zst')"

if [[ -n "$ZST_URL" ]]; then
  printf '==> Downloading native Arch package (%s)...\n' "$ZST_URL"
  curl -fL --progress-bar "$ZST_URL" -o "$PKG_FILE"
else
  # If a release only has the portable ELF binary (e.g. upstream release before .pkg.tar.zst CI step),
  # build a genuine .pkg.tar.zst locally from the release binary using scripts/build-arch-pkg.sh!
  PORTABLE_URL="$(extract_asset_url '_amd64-portable')"
  if [[ -z "$PORTABLE_URL" ]]; then
    printf 'Error: Could not find _amd64-portable or .pkg.tar.zst in release %s\n' "$TAG" >&2
    exit 1
  fi
  printf '==> Downloading RemoteFlow %s binary and packaging as .pkg.tar.zst...\n' "$VERSION"
  curl -fL --progress-bar "$PORTABLE_URL" -o "$TMP_DIR/remoteflow"
  chmod +x "$TMP_DIR/remoteflow"
  REMOTEFLOW_VERSION="$VERSION" bash "$SCRIPT_DIR/build-arch-pkg.sh" "$TMP_DIR/remoteflow" "$TMP_DIR"
fi

if [[ "$MODE" == "build-only" ]]; then
  cp -f "$PKG_FILE" "$OUT_DIR/"
  printf '✓ Saved Arch package: %s/%s\n' "$OUT_DIR" "$(basename "$PKG_FILE")"
  exit 0
fi

printf '==> Installing %s via pacman -U...\n' "$(basename "$PKG_FILE")"
sudo pacman -U --needed "$PKG_FILE"

if [[ "$WITH_OPTIONAL" == "yes" ]]; then
  printf '==> Installing optional packages (FreeRDP, XWayland, file picker, clipboard)...\n'
  sudo pacman -S --needed freerdp xorg-xwayland which zenity wl-clipboard xclip openssh
fi

printf '✓ RemoteFlow %s (.pkg.tar.zst) installed and tracked by pacman!\n' "$VERSION"
