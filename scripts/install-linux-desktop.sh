#!/usr/bin/env bash
# Register the portable binary/AppImage for this user; does not move the program or vault.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
program=$(realpath -- "${1:-$script_dir/remoteflow}")
if [[ ! -f "$program" || ! -x "$program" ]]; then
  printf 'Executable not found: %s\nUsage: bash %s /absolute/path/to/remoteflow-or.AppImage\n' "$program" "$0" >&2
  exit 1
fi
icon_source="$script_dir/remoteflow.png"
if [[ ! -f "$icon_source" ]]; then
  icon_source="$script_dir/../src-tauri/icons/icon.png"
fi
[[ -f "$icon_source" ]] || { printf 'Missing icon: %s\n' "$icon_source" >&2; exit 1; }
data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
[[ "$data_home" = /* ]] || { printf 'XDG_DATA_HOME must be absolute\n' >&2; exit 1; }
# Desktop Entry values cannot contain literal line breaks.
for value in "$program" "$data_home"; do
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { printf 'Unsupported line break in path\n' >&2; exit 1; }
done
icon="$data_home/icons/hicolor/512x512/apps/remoteflow.png"
mkdir -p -- "$(dirname -- "$icon")" "$data_home/applications"
cp -- "$icon_source" "$icon"

# Exec has both Desktop Entry string escaping and command-line quoting rules.
exec_path=${program//\\/\\\\}
exec_path=${exec_path//\"/\\\"}
exec_path=${exec_path//\$/\\\$}
exec_path=${exec_path//\`/\\\`}
exec_path=${exec_path//%/%%}
exec_path=${exec_path//\\/\\\\}
icon_path=${icon//\\/\\\\}
cat > "$data_home/applications/remoteflow.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RemoteFlow
Comment=SSH, SFTP and RDP connection manager
Exec="$exec_path"
Icon=$icon_path
Terminal=false
Categories=Development;Network;
StartupWMClass=remoteflow
EOF
chmod 644 "$data_home/applications/remoteflow.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$data_home/applications" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$data_home/icons/hicolor" >/dev/null 2>&1 || true
fi
printf 'Registered RemoteFlow: %s\nKeep the program at this path. Run this script again after moving it.\n' "$program"
