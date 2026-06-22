# Competitive Landscape

_Last surveyed: 2026-06-22. Updated 2026-06-22 after a full codebase review —
corrected Bedrock support (we ship it), added the POI/overlay surface, noted the
planned multiplayer proxy._

Sojourner is unusual in that it straddles two categories that the rest of the
market serves with separate tools: **save-file world rendering** (render what
actually exists in your `.mca` files — and Bedrock `db/` LevelDB worlds) and
**cubiomes-based seed prediction** (compute biomes/structures from the seed). Most
competitors do exactly one.

The single biggest differentiator: **none of the serious competitors read live
entities, block entities, or POI out of save files.** Sojourner's entity layer
(villagers colored by profession, mobs, item frames, minecarts, bosses…), its
8-group block-entity layer (containers, spawners, signs, bees, utility,
decorative, archeology, technical), and its POI layer (beds, workstations, bells)
are effectively unclaimed territory — and they work on **both Java and Bedrock**,
so we map living world-state on Bedrock that even uNmINeD (which renders Bedrock
but reads no entities) does not.

## Where a tool like this gets distributed

- **Standalone site + GitHub** — the default for this niche (uNmINeD, BlueMap,
  Overviewer, cubiomes-viewer all do this).
- **Microsoft Store** — low competition; `mcview` is the precedent.
- **itch.io** (tags: map, Minecraft) — viable for a polished paid/donation
  desktop tool; very few Minecraft mappers there.
- **CurseForge / Modrinth** — only if shipped as a mod/plugin; a standalone Tauri
  app doesn't fit cleanly.
- **Not viable:** Steam and the Mac App Store (Minecraft trademark + sandboxing).

## The four to watch

### uNmINeD — closest map-renderer rival
Fast, polished 2D viewer (solid-color, or textured at ≥4:1 zoom), Java + Bedrock +
experimental Hytale, auto-color extraction for modded/datapack blocks, image +
web-page + `.mcworld` export, sidebar that toggles **block categories**. Free.

- **Beats us on:** raw render speed, texture fidelity, Bedrock *block* rendering
  (textured), Hytale.
- **Lacks vs us:** entity/mob mapping (player markers only — on *either* edition),
  semantic block-entity grouping, POI, cubiomes seed prediction, slime chunks, ore
  veins/features, terrain relief, cave/carver/difficulty layers, a real
  marker-group editor. We now also read Bedrock, so it no longer owns that axis —
  it just renders Bedrock blocks faster than we do.

### MinedMap — lean Rust tile generator
Rust + Leaflet (same lineage as us), MIT, versions up to 26.1, PNG/WebP tiles,
night/illumination layer, incremental re-render, <100MB RAM, 3GB world in <5 min.
Its one annotation feature — **sign markers with prefix/regex/transform
filtering** — is a nice touch worth noting.

- **Beats us on:** render throughput, memory footprint.
- **Lacks vs us:** entities, mobs, block-entity grouping, biomes, structures,
  seed engine. It's a tile generator, not an interactive analysis tool.

### BlueMap — 3D heavyweight, but server-side
True **3D surface models** in-browser, async rendering, runs as
Spigot/Paper/Sponge/Fabric/Forge/standalone, has an API + proxy/network support.
Its **marker system is the most developed** of the group and worth studying:
**marker sets** (toggle a whole group at once, default visibility) plus POI /
HTML / Line / Shape / **Extrude** (Y-bounded volume) markers, distance culling,
custom CSS.

- **Beats us on:** 3D rendering, marker-set model maturity.
- **Categorically different:** it's a **live-server plugin**, not a save-file
  desktop app; markers are **admin-authored, not data-derived**. It renders no
  entities or auto-extracted block entities. Different audience entirely.

### cubiomes-viewer — our seed-engine sibling
Built on the **same cubiomes library we patched**. GPLv3, Win/Linux (no macOS),
Qt, very fast. Strong where we're thin: a **hierarchical condition-based seed
finder** (logic gates, helper conditions, **Lua custom filters**),
quad-hut/quad-monument generators, biome outlines across all three dimensions,
structure toggles, analysis tab (counts/sizes/positions).

- **Beats us on:** seed *searching* (we only *display* a known seed).
- **Lacks vs us:** it never opens a `.mca` — no rendered terrain, entities, block
  entities, or player data. Caps at 1.21 (we're at 26.2). Known 1.18+
  desert-pyramid / jungle-temple estimation failures.

## Feature matrix

| Capability | **Sojourner** | uNmINeD | MinedMap | BlueMap | cubiomes-viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| Real block render from save | ✅ (≥z3) | ✅✅ best | ✅ | ✅ 3D | ❌ |
| Cubiomes biome/structure predict | ✅ | ❌ | ❌ | ❌ | ✅✅ |
| **Entity mapping from save** | ✅✅ ~60 types | ❌ | ❌ | ❌ | ❌ |
| **Villagers by profession** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Block-entity semantic groups** | ✅ 8 groups | partial (blocks) | signs only | ❌ | ❌ |
| **POI from save (beds/workstations)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| Customizable marker groups | ✅ | shallow | ❌ | ✅✅ (sets) | ❌ |
| Slime chunks | ✅ | ❌ | ❌ | ❌ | ✅ |
| Ore veins (copper/iron) | ✅ | ❌ | ❌ | ❌ | partial |
| Ore features (diamond/gold/…) | ✅ | ❌ | ❌ | ❌ | partial |
| Terrain relief (hillshade) | ✅ | via textures | ❌ | ✅ (3D) | ❌ |
| Cave / carver / difficulty layers | ✅ | ❌ | ❌ | ❌ | ❌ |
| Generated-regions overlay | ✅ | ❌ | ❌ | ❌ | n/a |
| Seed *finder* (conditions) | ❌ | ❌ | ❌ | ❌ | ✅✅ |
| 3D view | ❌ | upcoming | ❌ | ✅✅ | ❌ |
| **Bedrock** | ✅ (blocks+markers) | ✅ | ❌ | ❌ | ❌ |
| Live multiplayer view | planned | ❌ | ❌ | ✅ (server) | ❌ |
| Version currency | **26.2** | 26.1 | 26.1 | current | 1.21 |
| Platform | desktop (Tauri) | desktop | CLI | server | desktop (no mac) |
| License / price | — | free | free MIT | free | free GPLv3 |

## Takeaways

1. **Entity + block-entity mapping is unclaimed.** Zero of the four read living
   entities or containers/spawners/signs as grouped, queryable objects. Lead with
   it.
2. **We're the only tool fusing both halves** — render-what-exists and
   compute-from-seed — in one app. Each competitor sits on one side of that line.
3. **Bedrock data depth is uniquely ours.** uNmINeD renders Bedrock blocks but
   reads no entities/block-entities/POI; we do both editions. "See every villager,
   chest, and spawner in your Bedrock world" is a sentence no competitor can write.
4. **Worth borrowing:** BlueMap's marker-set model (group toggle + default
   visibility + extrude/volume markers) for the MarkerGroupEditor; and
   cubiomes-viewer's condition/Lua **seed-finder** if we ever go from
   seed-viewing to seed-searching.
5. **Live multiplayer view (planned)** would be genuinely novel among save-file
   tools — only server-side BlueMap/Dynmap show live worlds today, and they need
   server-admin access. A client-side proxy that needs none is a different pitch.
   Not shipping yet; track it as a roadmap differentiator, don't market it.
6. **Don't compete on:** uNmINeD's render speed/texture polish, or BlueMap's 3D.
   Compete on data depth and edition coverage.

## Monetization

The whole desktop-mapper niche runs on a **donation/hobbyist economy**, not a
paid-software one. uNmINeD (freeware + Patreon/PayPal tip jar) and BlueMap (MIT +
Ko-fi/Patreon) both give every feature away and pass a hat. Neither tries to turn
a profit. The lesson: **charging for the renderer itself has a ceiling of "tips."**
The real money in Minecraft tooling is adjacent — ad-supported seed *websites*
(Chunkbase, mcseedmap), server-hosting bundles (BlueMap/Dynmap as loss leaders),
and CurseForge's per-download reward pool (JourneyMap/Xaero's). A standalone
desktop app can't reach the last two and shouldn't try to out-free uNmINeD.

So the question isn't "how do we charge for a map renderer" — it's "which audience
will pay for the thing only we have." Our unclaimed asset is **data depth**:
entity mapping (villagers by profession, mobs, minecarts, bosses), 8-group
block-entity extraction, and structured export. Paths, best-fit first:

### 1. Paid niche: data-export / "world intelligence" (best fit)
Lean into the one thing no competitor does. Charge for **structured export and
bulk queries**, not for looking at the map:
- CSV/JSON/GeoJSON export of entities + block entities ("every chest and its
  contents," "all villagers by profession," "every spawner") — the TIFF/GIS-style
  export work already points here.
- Server admins, large-SMP curators, and content creators are the willing payers:
  they need inventories, loot audits, mob-farm planning, grief/loss forensics —
  and the **Bedrock realm/server** crowd has *no* tool that extracts this at all.
- Model: **free viewer, paid export/analysis tier** (one-time "Pro" unlock or
  low monthly). This is the only path where our differentiation maps to dollars.

### 2. Ad-supported companion web tool
A browser **seed + structure viewer** (the cubiomes half, no save upload needed)
monetized by display ads — the proven model in this space. It doubles as the
**top-of-funnel** that drives people to the desktop app. Costs: hosting + an SEO
fight against entrenched sites. Pairs well with #1 rather than competing with it.

### 3. CurseForge/Modrinth companion mod
A thin in-game exporter mod that writes the data Sojourner reads, distributed on
CurseForge to tap its **reward program** (per-download payouts). Indirect revenue,
plus distribution and brand reach into the mod audience. Engineering cost is a
separate Java/mod codebase — only worth it if #1 validates demand.

### What to avoid
- **Paywalling the renderer.** uNmINeD is free and faster (and also reads
  Bedrock); we lose a pure rendering fight. Charge for the data layer, not the map.
- **A subscription with no recurring value.** Export/analysis can justify
  recurring cost (new MC versions, new data types); a static viewer cannot.

**Recommended sequencing:** ship #1 (free viewer + paid export tier) as the core
business, stand up #2 as the marketing funnel, treat #3 as optional reach once
demand is proven.

## Sources

- uNmINeD — https://unmined.net/
- MinedMap — https://github.com/neocturne/MinedMap
- BlueMap — https://bluemap.bluecolored.de/ · markers: https://bluemap.bluecolored.de/wiki/customization/Markers.html
- cubiomes-viewer — https://github.com/Cubitect/cubiomes-viewer
- Chunkbase — https://www.chunkbase.com/apps/seed-map
- mcview (Microsoft Store) — https://apps.microsoft.com/detail/9n91b7rljv9f
