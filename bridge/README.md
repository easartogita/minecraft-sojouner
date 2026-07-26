# Sojourner Bridge

A **read-only NeoForge mod** that streams live Minecraft world state — player, entities,
chunk loads, block changes — over a local **WebSocket** as JSON. It's the sensory layer for
driving the player with an external agent (and a live feed for Sojourner itself).

This is step 1: **observe and stream only**. The mod never mutates the world. The inbound
WebSocket direction is reserved for the later actuation step.

```
 Minecraft (NeoForge, server side)
   └─ GameEvents ──capture──▶ Snapshots ──JSON──▶ Broadcaster ──▶ WebSocket :25599
                                                                      │
                                              external consumer ◀─────┘
                                       (Sojourner oracle / agent brain / debug client)
```

## Status / what works

- Periodic `tick` snapshots: players (pos, health, hunger, xp, inventory, effects, …),
  nearby entities, and world meta (time, weather, difficulty, seed, spawn).
- Entity add/remove, chunk load/unload, and player block break/place deltas.
- Loopback-only bind; zero overhead when no client is connected.

## Known gaps (next increments)

- **Block deltas are player-only.** Pistons/fluids/explosions/growth aren't events — they
  need a Mixin into `LevelChunk.setBlockState`. Scaffolding for that isn't here yet.
- **Block entities** (chests/furnaces/spawners) aren't streamed yet — mirror Sojourner's
  at-rest readers next.
- No backpressure: every snapshot is broadcast regardless of client drain rate.

## Build

> ⚠️ **Version pinning required.** This was scaffolded against the repo's MC 26.2 target,
> but the exact NeoForge build, `pack_format`, and Java level must be confirmed:
>
> 1. Grab the matching MDK / build from <https://projects.neoforged.net/neoforged/neoforge>.
> 2. Set `neo_version` (+ the `*_range` values) in `gradle.properties`.
> 3. Confirm the Java toolchain in `build.gradle` and `pack_format` in
>    `src/main/resources/pack.mcmeta`.
> 4. Adjust `jarJar(...)` packaging if your ModDevGradle version differs.
>
> Event class/method names (`ServerTickEvent.Post`, `BlockEvent.EntityPlaceEvent`, …) track
> NeoForge 1.21-era APIs and may need small tweaks for the exact build.

```bash
cd bridge
gradle wrapper            # generate ./gradlew (one-time; not committed)
./gradlew build          # → build/libs/sojourner_bridge-0.1.0.jar
```

Drop the jar into your server/client `mods/` folder (works in singleplayer via the
integrated server).

## Try it

With a world loaded, connect any WebSocket client to `ws://127.0.0.1:25599` and watch the
stream:

```bash
# e.g. with websocat
websocat ws://127.0.0.1:25599
```

See [`docs/protocol.md`](docs/protocol.md) for the full message catalogue and config knobs.
