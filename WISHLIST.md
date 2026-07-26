# Wishlist

Ideas and future directions that aren't on the immediate roadmap. See TODO.md for actively tracked items.

## Route Planner, Pin UX

See `TODO_WAYPOINTS.md` — split into its own file, big enough (per-leg travel modes, biome-aware boat splitting, nether-highway timing, pin groups) to no longer fit as a wishlist bullet.

## Find Chest With Item

Search the open world for any chest, barrel, hopper, dispenser, or shulker box containing a specific item. Block entities are stored in the same chunk NBT already parsed for tile rendering — the new work is scanning all `.mca` files and extracting inventories.

Key design questions:
- **Query model** — match by item ID (`minecraft:diamond`), display name (renamed items), enchantment, or some combination
- **Search scope** — full world scan or user-defined radius; needs a background job with progress reporting since a large world can have hundreds of region files
- **Result display** — clickable map markers that fly to the chest location, plus a results list panel

On the Rust side: scan chunks via `fastnbt`, extract `block_entities` arrays, filter by container block types, walk the `Items` NBT list.
