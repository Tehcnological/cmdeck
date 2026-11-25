#!/usr/bin/env bash
# Renders CMDeck's placeholder mark (assets/prod/logo.svg) over every tracked raster app icon,
# keeping each file's existing pixel size. Stands in for `vp run icons:export`, which needs Apple's
# Icon Composer 2 (not available on CI runners). Needs rsvg-convert and ImageMagick.
# Usage: scripts/fork/render-placeholder-icons.sh
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
svg="assets/prod/logo.svg"
grep -q "CMDeck placeholder" "$svg" || { echo "$svg is not the CMDeck placeholder" >&2; exit 1; }

magick_cmd="magick"
command -v magick >/dev/null 2>&1 || magick_cmd="convert"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

render_png() { # size out
  rsvg-convert -w "$1" -h "$1" "$svg" -o "$2"
}

count=0
while IFS= read -r file; do
  case "$file" in
    *.png)
      size="$($magick_cmd identify -format '%w' "$file")"
      render_png "$size" "$file"
      ;;
    *.ico)
      layers=()
      for size in 16 24 32 48 64 128 256; do
        render_png "$size" "$tmp/$size.png"
        layers+=("$tmp/$size.png")
      done
      $magick_cmd "${layers[@]}" "$file"
      ;;
  esac
  count=$((count + 1))
done < <(git ls-files 'assets/dev/*.png' 'assets/dev/*.ico' 'assets/nightly/*.png' \
  'assets/nightly/*.ico' 'assets/prod/*.png' 'assets/prod/*.ico' \
  'apps/web/public/*.png' 'apps/web/public/*.ico')

echo "Rendered the placeholder into $count icon files."
