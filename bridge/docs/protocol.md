# Sojourner Bridge — wire protocol (v0.1)

One WebSocket, one JSON object per frame. Every frame is an **envelope**:

```json
{ "type": "<event>", "tick": 123456, "data": { ... } }
```

- `type` — message kind (below).
- `tick` — server tick count at emission (monotonic per server run; ~20/sec).
- `data` — type-specific payload.

The stream is currently **one-way** (server → client). Inbound frames are ignored; they
become the command channel in the actuation step.

## Coordinates

Block/entity positions are Minecraft world coordinates: `+X` east, `+Z` south, `+Y` up.
(Sojourner's Leaflet view flips Z and scales — convert on the consumer side, as the app
already does in `lib/tileCoords.ts`.)

## Message types

### `tick` — periodic snapshot (heartbeat)
Emitted every `snapshotTicks` ticks (default 4 ≈ 5 Hz), once per loaded level with players.

```json
{ "type": "tick", "tick": 123456, "data": {
  "dimension": "minecraft:overworld",
  "dayTime": 1042, "seed": -428751,
  "raining": false, "thundering": false, "difficulty": "normal",
  "spawn": { "x": 0, "y": 64, "z": 0 },
  "players": [ { /* player object */ } ],
  "entities": [ { /* entity object */ } ]
} }
```

**player object**
```json
{ "id": 215, "uuid": "…", "type": "minecraft:player", "name": "Steve",
  "pos": {"x":12.5,"y":71,"z":-8.2}, "velocity": {"x":0,"y":-0.08,"z":0},
  "yaw": 90.0, "pitch": -3.5,
  "health": 20.0, "maxHealth": 20.0, "food": 18, "saturation": 4.2,
  "xpLevel": 7, "gameMode": "survival", "selectedSlot": 0, "onGround": true,
  "effects": [ {"effect":"minecraft:speed","amplifier":0,"duration":380} ],
  "inventory": [ {"slot":0,"item":"minecraft:iron_pickaxe","count":1} ] }
```

**entity object** — `baseEntity` fields, plus `health`/`maxHealth` for living entities and
`item` for dropped items.

### `entityAdd` / `entityRemove` — entity deltas
`entityAdd.data` is a full entity object. `entityRemove.data` is `{ "id", "uuid" }`.

### `chunkLoad` / `chunkUnload` — chunk deltas
```json
{ "type": "chunkLoad", "tick": 123456,
  "data": { "dimension": "minecraft:overworld", "cx": 3, "cz": -1 } }
```

### `blockChange` — block delta
Player break/place only in v0.1. Indirect changes (pistons, fluids, explosions, growth)
arrive once the `LevelChunk.setBlockState` Mixin lands.
```json
{ "type": "blockChange", "tick": 123456, "data": {
  "dimension": "minecraft:overworld",
  "pos": {"x":12,"y":70,"z":-8},
  "block": "minecraft:stone",
  "state": "Block{minecraft:stone}" } }
```

## Configuration (JVM system properties / env vars)

| Property | Env | Default | Meaning |
|---|---|---|---|
| `sojourner.bridge.port` | `SOJOURNER_BRIDGE_PORT` | `25599` | WebSocket port |
| `sojourner.bridge.host` | `SOJOURNER_BRIDGE_HOST` | `127.0.0.1` | bind address |
| `sojourner.bridge.snapshotTicks` | `SOJOURNER_BRIDGE_SNAPSHOTTICKS` | `4` | ticks between snapshots |
| `sojourner.bridge.entityRadius` | `SOJOURNER_BRIDGE_ENTITYRADIUS` | `64` | entity stream radius (blocks) |
