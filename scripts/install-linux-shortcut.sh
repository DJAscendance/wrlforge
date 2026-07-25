#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "WRL Forge desktop integration is available on Linux only." >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Source checkout: scripts/ sits below launch.sh + assets/.
if [[ -x "$script_dir/../launch.sh" && -f "$script_dir/../assets/wrl-forge-cyan.svg" ]]; then
  launcher="$(cd -- "$script_dir/.." && pwd)/launch.sh"
  source_icon="$script_dir/../assets/wrl-forge-cyan.svg"
# electron-builder tar/unpacked app: this script, executable, and SVG are peers.
elif [[ -x "$script_dir/wrl-forge" && -f "$script_dir/wrl-forge.svg" ]]; then
  launcher="$script_dir/wrl-forge"
  source_icon="$script_dir/wrl-forge.svg"
else
  echo "Could not find the WRL Forge launcher and cyan icon beside this installer." >&2
  exit 1
fi

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
applications_dir="$data_dir/applications"
icons_dir="$data_dir/icons/hicolor/scalable/apps"
desktop_target="$applications_dir/wrl-forge.desktop"
icon_target="$icons_dir/wrl-forge.svg"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p -- "$applications_dir" "$icons_dir"

# XDG Exec values use double-quoted arguments with backslash escapes for these
# four reserved characters. This keeps checkouts/extract locations with spaces,
# quotes, dollar signs, or backticks launchable.
exec_path="${launcher//\\/\\\\}"
exec_path="${exec_path//\"/\\\"}"
exec_path="${exec_path//\`/\\\`}"
exec_path="${exec_path//\$/\\\$}"

desktop_tmp="$(mktemp "$applications_dir/.wrl-forge.desktop.XXXXXX")"
trap 'rm -f -- "$desktop_tmp"' EXIT
{
  printf '%s\n' '[Desktop Entry]'
  printf '%s\n' 'Type=Application'
  printf '%s\n' 'Name=WRL Forge'
  printf '%s\n' 'Comment=A modern VRML97 creation, inspection, validation, and packaging workbench for Cybertown items and worlds.'
  printf 'Exec="%s" %%f\n' "$exec_path"
  printf '%s\n' 'Icon=wrl-forge'
  printf '%s\n' 'Terminal=false'
  printf '%s\n' 'Categories=Graphics;'
  printf '%s\n' 'MimeType=model/vrml;'
  printf '%s\n' 'StartupNotify=true'
} > "$desktop_tmp"
chmod 0644 "$desktop_tmp"

# Preserve a customized pre-existing entry/icon before replacing it. Identical
# generated files need no backup.
if [[ -f "$desktop_target" ]] && ! cmp -s -- "$desktop_target" "$desktop_tmp"; then
  cp -p -- "$desktop_target" "$desktop_target.bak-$timestamp"
fi
if [[ -f "$icon_target" ]] && ! cmp -s -- "$icon_target" "$source_icon"; then
  cp -p -- "$icon_target" "$icon_target.bak-$timestamp"
fi

install -m 0644 -- "$source_icon" "$icon_target"
mv -f -- "$desktop_tmp" "$desktop_target"
trap - EXIT

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$desktop_target"
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications_dir"
fi

printf 'Installed WRL Forge desktop integration:\n  %s\n  %s\n' "$desktop_target" "$icon_target"
printf 'WRL Forge is now available as an Open With choice for .wrl/.wrz files.\n'
