# Sojourner design language

**Thesis: expedition instrument.** Sojourner is a surveyor's tool for a world made of
blocks. The map is the hero — chrome stays dark, quiet, and recessive — but every
glyph, number, and control should feel like it belongs to *this* instrument and no
other. The identity comes from two sources: Minecraft's pixel-grid materiality
(icons, the wordmark) and cartographic instrument conventions (monospace data,
tick-strip zoom, segmented mode controls).

**The problem being fixed.** The current chrome is GitHub Dark's exact token values
(`#0d1117`, `#58a6ff`, ...) with OS emoji for icons and one system font at one size.
It is coherent but anonymous — nothing in the chrome could only belong to this app.

## Tokens

### Color

Chrome neutrals shift off GitHub's blue-gray to a neutral mineral gray (deepslate,
not slate-blue). The accent moves from GitHub blue to amethyst — a material that
exists in the game, rare on the map surface itself (so it never fights biome
colors), and uncommon as a dashboard accent.

| Token | Value | Role |
|---|---|---|
| `--deepslate-0` | `#101114` | app background (was `#0d1117`) |
| `--deepslate-1` | `#17191d` | panels, flyouts (was `#161b22`) |
| `--deepslate-2` | `#212429` | hover, raised surfaces (was `#21262d`) |
| `--border` | `#2e3238` | hairlines (was `#30363d`) |
| `--text-primary` | `#e8eaed` | primary text |
| `--text-secondary` | `#9aa0a8` | secondary text |
| `--text-muted` | `#565b63` | muted / disabled |
| `--amethyst` | `#b48ce0` | accent: selection, active states, focus (replaces `#58a6ff`) |
| `--amethyst-hover` | `#c8a5f0` | accent hover |
| `--emerald` | `#3fb950` | positive / online |
| `--redstone` | `#f85149` | destructive / error |
| `--gold` | `#d29922` | warning / caution |

Semantic colors keep their current values (they're already Minecraft-adjacent names
in spirit: emerald, redstone, gold) — only the accent and neutrals change. Biome and
marker colors on the map are content, not chrome, and are untouched.

### Type

Three roles, expressed as tokens (`--font-ui`, `--font-mono` in `global.css`).
**Decision (2026-07): no bundled font files** — the visible gain on a desktop app
for one machine didn't justify new binary assets. The stacks name Plex first, so
dropping woff2 files into `src/renderer/assets/fonts/` + one `@font-face` block
activates them later with zero refactoring.

| Role | Stack | Usage |
|---|---|---|
| UI | `'IBM Plex Sans', system sans` | labels, controls, body. 13px base, 11px dense. |
| Data | `'IBM Plex Mono', 'DejaVu Sans Mono', ui-monospace` | **all** coordinates, distances, Y-values, seeds, counts, times. Replaced every `'Courier New'`. |
| Display | (none) | The wordmark and rail labels are pixel-lettered or mono caps — no third face. Restraint here; the icons carry the identity. |

**Mono-as-data is law.** The coordinate HUD already does this — promote it: any
number a player might read aloud or type into chat is monospace, everywhere.

### Control hierarchy (toolbar)

Three visually distinct control kinds, replacing the uniform gray pill:

1. **Mode** (you are in exactly one): segmented control, joined cells, filled
   active cell — dimension switcher, Surface/Cave/Deep.
2. **Overlay toggle** (independent on/off): grouped toggle set in a shared
   container, pixel icon + label, amethyst active tint — Biomes, Chunk Data,
   Slime Chunks, Ore Veins, Routes, Grids.
3. **Action** (one-shot): quiet icon button — Center, Follow, Reset.

Zoom indicator: replace the 13 hollow circles with a ruler tick-strip (filled
current tick) plus a mono readout (`z +6`). Cartographic, compact, legible.

## Signature: the pixel-grid icon set

One custom icon family, drawn on a strict 16×16 pixel grid as inline SVG
(`fill="currentColor"`, `shape-rendering="crispEdges"`), same discipline as the
game's 16×16 textures. Single color + opacity steps only — they read as instrument
glyphs, not game sprites. This is the one aesthetic risk; everything around it
stays quiet.

Metaphors are game-native where the game has one:

| Icon | Metaphor |
|---|---|
| World | grass block (front face, uneven grass line) |
| Layers | three strata slabs, opacity fading with depth — literally Surface/Cave/Deep |
| Places | compass (the item) |
| Saved | banner/swallowtail flag (the game's own waypoint vernacular; doubles as bookmark) |
| Settings | pixel gear |
| ...later | center-on-spawn, follow-player, export, pin, route for toolbar & menus |

Replaces every emoji (`🌍 🧭 📌 ⚙` in the rail, `📌` in SavedFlyout, WorldFlyout's
set) and stray text glyphs (`◈`, `⊙`). `✓`/`✕` may stay as text — they are
typographic, not iconographic.

## Phasing

1. **Icons** — pixel icon set component (`components/icons.tsx`), swap the rail,
   then flyouts and toolbar glyphs. *(done — 13 glyphs, zero emoji left)*
2. **Palette + accent** — retint neutrals, amethyst accent, kill the GitHub
   values. *(done — semantic category colors, e.g. F3 legend blues, kept)*
3. **Toolbar hierarchy** — segmented dimension control, grouped overlays,
   icon actions, tick-strip zoom. *(done)*
4. **Type** — token stacks + mono-as-data law. *(done, sans bundled files — see
   Type section)*
5. **Flyout polish** — Layers rows: name left, help/hotkey chips right-aligned,
   mode radios as segmented controls. *(done for Layers; Settings grouping and
   the world-picker wordmark remain open)*

## Self-critique (why this isn't the default)

The reflex answer for "dark map tool" is near-black chrome + one acid accent, Inter
everywhere — that's the template. This plan's choices are all subject-derived:
amethyst because it's a game material that stays off the map surface; strata icons
because the app literally has Surface/Cave/Deep; mono-as-data because players
exchange coordinates as text; pixel grid because the game's entire visual language
is 16×16. The boldness budget is spent once, on the icons — palette and type stay
disciplined so the map keeps winning.
