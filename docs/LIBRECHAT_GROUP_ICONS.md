# LibreChat model-spec group icons

Group icons in `librechat.yaml` (modelSpecs list) use inline SVG data URIs. Icons are rendered as `<img src="...">`, so **`currentColor` does not apply** — use explicit hex stroke/fill for light and dark theme.

## Current assignment

| Group | Icon | Stroke color | Rationale |
|-------|------|--------------|-----------|
| Empfohlen: Europa & Open Source | Bot | `#059669` (green-600) | Open source / automation; good contrast both themes |
| Premium-Modelle | Lock | `#d97706` (amber-600) | Proprietary / not open source |
| Assistenten | Bot-message-square | `#ab68ff` (brand-purple) | Matches LibreChat brand |

## Theme-compatible colors (LibreChat)

From `dev/librechat/client/src/style.css` — use these for new group icons so they work in light and dark:

| Use | Light (`html`) | Dark (`.dark`) | Hex suggestion |
|-----|----------------|----------------|----------------|
| Primary text | gray-800 `#212121` | gray-100 `#ececec` | — (avoid; use semantic colors) |
| Submit / positive | green-700 `#047857` | green-700 | `#059669` (green-600) |
| Warning / premium | amber-500 `#f59e0b` | amber-500 | `#d97706` (amber-600) |
| Brand | `#ab68ff` | `#ab68ff` | `#ab68ff` |
| Neutral icon | gray-600 `#424242` | gray-400 `#999696` | `#6b7280` (mid gray) |

## Optional: background or stroke

- **Stroke only** (current): Single hex color; simple and readable.
- **Subtle background**: Add a circle with `fill="<color>" fill-opacity="0.12"` so the icon has a soft tint; use the same hex as stroke for consistency.
- **Two-tone**: e.g. stroke `#059669` + inner fill `#059669` with lower opacity for a “badge” look.

## Assets

- **Assistenten**: Source SVG is `assets/bot-message-square.svg`. The group icon in config uses the same path data with `stroke="#ab68ff"`. To change the icon, edit the asset and regenerate the base64 data URI (e.g. `Buffer.from(svgString).toString('base64')`).

## Regenerating a data URI

```bash
# Minify SVG (remove newlines/extra spaces), then:
node -e "console.log('data:image/svg+xml;base64,' + Buffer.from(require('fs').readFileSync('/dev/stdin','utf8').replace(/\s+/g,' ').trim()).toString('base64'))" < icon.svg
```
