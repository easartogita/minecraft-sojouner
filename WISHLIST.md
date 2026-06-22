# Wishlist

Ideas and future directions that aren't on the immediate roadmap. See TODO.md for actively tracked items.

## Route Planner

Click a sequence of waypoints on the map; the app draws the path and reports:

- Total overworld distance (blocks)
- Nether equivalent (÷8 on X/Z, shown as secondary label)
- Per-leg breakdown

Waypoints snap to nearby structure or pin markers on click. The route is temporary (cleared on next click-away) unless saved as a named pin group.

Practical use: planning a nether highway layout before digging — map out the overworld destinations, read off the nether coordinates for each portal.

## Find Chest With Item

Search the open world for any chest, barrel, hopper, dispenser, or shulker box containing a specific item. Block entities are stored in the same chunk NBT already parsed for tile rendering — the new work is scanning all `.mca` files and extracting inventories.

Key design questions:
- **Query model** — match by item ID (`minecraft:diamond`), display name (renamed items), enchantment, or some combination
- **Search scope** — full world scan or user-defined radius; needs a background job with progress reporting since a large world can have hundreds of region files
- **Result display** — clickable map markers that fly to the chest location, plus a results list panel

On the Rust side: scan chunks via `fastnbt`, extract `block_entities` arrays, filter by container block types, walk the `Items` NBT list.

## Cave Entrance Detection

Parse the `MOTION_BLOCKING` vs `WORLD_SURFACE` heightmaps already read from `.mca` files. Where `WORLD_SURFACE` Y is significantly higher than `MOTION_BLOCKING` Y at the same column, there's likely an air pocket just below the surface — a cave entrance, ravine, or overhang.

Render as a faint overlay (similar to the slime chunk layer) that highlights these columns. Only visible at chunk-data zoom levels since it requires per-block heightmap data.

## Pin UX

- **Right-click context menu on the map** — "Drop pin here", "Copy coordinates". More discoverable than Ctrl+click.
- **Pin categories / colors** — assign a color to a pin, rendered as a colored marker, filterable in the sidebar.
- **Pin notes** — multi-line text field per pin, shown in tooltip on the marker.
- **Import/export** — export as JSON or `/tp` command list.
