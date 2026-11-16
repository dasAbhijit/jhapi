#!/bin/sh
# Builds the PNG app icons from public/favicon.svg. macOS only (uses Quick Look and sips).
# Run after changing the SVG: npm run icons
set -e
cd "$(dirname "$0")/../public"
tmp=$(mktemp -d)
qlmanage -t -s 512 -o "$tmp" favicon.svg >/dev/null 2>&1
src="$tmp/favicon.svg.png"
cp "$src" icon-512.png
sips -z 192 192 "$src" --out icon-192.png >/dev/null
sips -z 180 180 "$src" --out apple-touch-icon.png >/dev/null
# Maskable: the same art shrunk to the 80% safe zone on a full-bleed background.
sed -e 's/rx="112"/rx="0"/' -e 's#<ellipse#<g transform="translate(51.2 51.2) scale(0.8)"><ellipse#' -e 's#</text>#</text></g>#' favicon.svg > "$tmp/maskable.svg"
qlmanage -t -s 512 -o "$tmp" "$tmp/maskable.svg" >/dev/null 2>&1
cp "$tmp/maskable.svg.png" icon-maskable-512.png
rm -rf "$tmp"
echo "Icons written to public/"
