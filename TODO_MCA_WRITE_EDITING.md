# TODO: Write-Editing `.mca` (entities, terraforming, structure import)

Scoping notes — **not yet committed to the project.** Captures how big a lift it
would be to add write support, so we can decide if it's in scope.

## Bottom line

The app is **100% read-only today**, but ~half the plumbing for writing already
exists. The three use cases differ wildly in size:

| Use case | Lift | Rough effort |
|---|---|---|
| Entity / block-entity **property** edits | Moderate | ~1 focused week (Java, offline worlds) |
| Terraforming (block edits) | Large | Several × Tier 1 |
| Structure import | Large-plus | Terraforming + format parsing |

The gating difficulty is **not parsing** — it's safely mutating someone's save
data, and (for blocks) lighting/heightmaps.

## What already helps

- `read_chunk_nbt` decodes a chunk to an **owned `fastnbt::Value`**, and
  `fastnbt = "2"` supports `to_bytes` — NBT round-tripping is available out of
  the box. De-risks the entire entity-edit path.
- Reader already locates region files (`find_region_file`, `find_entity_file`),
  parses the Anvil sector headers, and decompresses (gzip/zlib). Writing is the
  mirror of code we already have.
- File watcher, dimension/path handling, and Java/Bedrock dispatch all in place.

Missing everywhere: an Anvil **writer** (serialize → compress → allocate
sectors → update offset + timestamp headers). Note the block-reading structs
(`SectionView`) are zero-copy borrowed views built for reading — you don't
mutate those; you mutate the owned `Value` from `read_chunk_nbt` and
re-serialize.

## Tier 1 — Entity / block-entity property editing (moderate)

Change a mob's health, a sign's text, a spawner's mob, a chest's contents.
Flow: read chunk (or `entities/r.x.z.mca`) NBT → mutate the `Value` tree →
serialize → write back.

- **New code:** a region-file writer. Simple correct version rewrites the whole
  region file sequentially (read all chunks, swap the one, re-pack) instead of
  in-place free-sector management — ~150 lines + tests, sidesteps fragmentation
  bugs. Occasional edits don't need the fast path.
- **No lighting or heightmap work** — not touching blocks, so nothing downstream
  needs recomputing. This is what keeps the tier small.
- **Real work is the safety layer + UI**, not the parsing (see cross-cutting).
- Block entities live in the chunk NBT; entities (1.17+) live in the separate
  `entities/` region file — both are the same round-trip pattern, so this tier
  covers both.

## Tier 2 — Terraforming / block edits (large)

Setting even a single block is much harder because sections are **paletted**: a
per-section block palette + a packed `LongArray` of indices at variable
bits-per-block. To place a block you must add its full blockstate (name **and**
properties, e.g. `oak_log[axis=y]` — reader only pulls `Name` today) to the
palette, recompute bits-per-block, and repack the whole 4096-entry index array
with the 1.16+ no-straddle packing. Then:

- **Recompute heightmaps** (WORLD_SURFACE, MOTION_BLOCKING, OCEAN_FLOOR…) or both
  MC and our renderer show the wrong surface. We already scan sections top-down
  in the no-heightmap render path, so this is half-done.
- **Lighting is the genuinely hard part.** Options: clear the chunk's
  light-populated flag so MC relights on next load (cheap, but edits look wrong
  until reload, and the mechanism shifted across versions), or write a flood-fill
  light engine (a real subsystem). Every editor (MCEdit, Amulet, WorldEdit)
  wrestles with this; for a viewer-first app, punt to the flag approach with a
  documented caveat.
- Need a source of **valid blockstates per game version** — a data-sourcing task
  cubiomes doesn't cover.

## Tier 3 — Structure import (large-plus, built on Tier 2)

Once Tier 2 exists: parse a `.nbt`/`.schem`, iterate, place. Adds format
parsing, placement/offset handling, and importing the structure's own block
entities (chest loot, spawners) and entities. Incremental on top of
terraforming, not a fresh subsystem.

## Cross-cutting (applies to all tiers; dominates Tier 1's cost)

- **Save-data safety is the gating risk, not code volume.** Writing region files
  while MC has the world open corrupts data or gets silently overwritten on MC's
  next save. Gate on the world not being live — check `session.lock`, refuse (or
  loudly warn) otherwise. Plus automatic backups before any write, ideally undo.
- **Watcher feedback loop:** our writes fire `region:changed`. Suppress
  self-writes (ignore paths we just wrote, or pause the watcher around a write).
  Cheap but must-do; ties into the region-settle throttle in `file_watcher.rs`.
- **Bedrock roughly doubles everything** — LevelDB put + little-endian NBT + a
  different subchunk format. Scope Bedrock writes **out of v1**.
- **Build vs. borrow:** keep fastnbt (it round-trips). For the Anvil writer
  there's no clearly-better maintained Rust *writer* crate (fastanvil is
  read-focused), so hand-rolling a focused writer is consistent with how we
  hand-rolled the reader and with the minimal-dependency / zero-trust posture.

## Recommended path (if pursued)

Do **Tier 1 first as a standalone milestone**: Java, offline worlds, entity +
block-entity property edits, with the session-lock gate and pre-write backups.
It proves the whole write + safety pipeline on the low-risk case (no lighting,
no heightmaps, no palette repacking) and is useful on its own. Only take on
terraforming once that's solid — Tier 2 is where the palette writer, heightmap
recompute, and lighting strategy all land at once. That's the real cliff; don't
hit it while also debugging first-ever writes to a save.

### Open questions to decide scope

- Is write-editing in scope for this app at all, or does it belong in a separate
  tool? (Viewer vs. editor is a real product-identity fork.)
- Java-only acceptable for v1, or is Bedrock parity required?
- Appetite for the lighting problem, or accept "relight-on-reload" caveats?
- Backup/undo expectations — how much safety UX before first write ships?
