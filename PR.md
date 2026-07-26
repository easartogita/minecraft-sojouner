# PR draft — getOreVeinStrengthAt → xpple/cubiomes

> Working scratch file (not part of the cubiomes feature branch). Branch:
> `feat/ore-vein-strength` on `easartogita/cubiomes`. Target: `xpple/cubiomes:master`.
>
> **Honest framing.** The point of posting is app exposure + a real answer on vein
> sparsity — not the patch. `getOreVeinStrengthAt` is a *thin* helper: it bundles the
> gate `getOreVeinBlockAt` already uses (Y-bands + `0.4F` threshold + edge falloff) so
> callers don't copy those constants or drift from the generator — but the underlying
> noise (`OreVeinParameters.oreVeininess`) is already public, so anyone could sample it
> directly. Offer the PR as *"worth it, or trivial?"*; "just sample the noise yourself"
> is a fair answer and costs nothing. Do **not** pitch it as a perf win — density being
> cheaper than per-block is inherent to noise-vs-placement, not something this unlocks.

## Where this stands (catch-up log)

**As of 2026-06-22 — flare is out, nothing committed.**

- **Posted to Discord.** Dropped the opener + `docs/ore-vein-comparison.png` in xpple's
  Discord (`discord.xpple.dev`), channel `#general-dev`, as **Easar Togita**. Used the casual
  version ("futzing for funzies… once per block gets me a ghost, are ore veins really that
  thin?") and **kept the word "veininess"** — so be ready for a "how are you sampling it?"
  follow-up; honest shrug answer: *"once per chunk I grab the ore_veininess noise and threshold
  the magnitude — fuzzy on the internals, landed on it empirically."* No reply yet when posted;
  channel was active (xpple mid-thread on commit `cef4577`).
- **Strategy in play:** smart outsider, not fake insider. App exposure + a real answer on vein
  sparsity is the goal; the relationship is the asset. Hold the `getOreVeinStrengthAt` offer back —
  only if someone bites, float it modestly as *"worth a PR, or trivial?"*. Disposition: fine being
  wrong as long as I learn why.
- **Honest reassessment (important):** the helper is a *thin convenience/DRY wrapper*, not a perf
  win or new capability — the `oreVeininess` noise is already public, so anyone could sample it.
  The earlier "~135× faster" framing was dropped as misleading; the comparison image now just asks
  the honest sparsity question.

**Code state (all uncommitted / unpushed):**
- `cubiomes` fork (`easartogita/cubiomes`, branch `feat/ore-vein-strength`): `getOreVeinStrengthAt`
  in `finders.{c,h}` + `includes.txt` line. Verified vs `getOreVeinBlockAt` (7.27M positions, 0
  mismatches). Branch is local-only — **not pushed**.
- Sojourner `src-tauri/cubiomes_bridge.c`: `cm_get_ore_veins_at2` rewired onto the helper, two dead
  siblings removed. `.gitmodules` → the fork. Temp perf instrumentation was added then **reverted**
  (code is clean).
- `docs/`: `ore-vein-{none,density,footprint,comparison}.png`, `competitive-landscape.md` (SeedMapper
  section added), `web-serving-architecture.md`.

**Next, when a reply lands:**
- *"veins are just sparse"* → "ah, that's what I needed."
- *"how are you sampling it?"* → the honest shrug above.
- Someone bites on the helper or the app → offer the PR modestly / talk Sojourner.
- Then decide: push `feat/ore-vein-strength` to the fork and open the PR to `xpple/cubiomes`, or let it ride.

## Title

```
Add getOreVeinStrengthAt for ore-vein field / density queries
```

## Body

### What

Adds `getOreVeinStrengthAt(x, y, z, OreVeinParameters*, double *strength)` to
finders.{c,h}, alongside the existing `getOreVeinBlockAt`.

It returns the deterministic ore-vein *field* — which vein a position belongs to
(`CopperVein`/`IronVein`, or `-1`) and, via `*strength`, how strongly — without the
ridged-shape mask or the per-block random thinning that `getOreVeinBlockAt` applies
to resolve an individual block.

### Why

`getOreVeinBlockAt` answers "what block is at (x,y,z)" — it applies the ridged mask
and per-block RNG. Area consumers (map overlays, vein locators) instead want the
*deterministic field* underneath. You can already sample
`OreVeinParameters.oreVeininess` directly, but to match what the generator actually
gates on you also need the per-ore Y-bands, the `0.4F` threshold, and the vertical
edge-falloff term — all currently local to `getOreVeinBlockAt`. This helper returns
exactly that gate quantity (`fabs(veininess)` + falloff) with the ore type, so callers
stay in lockstep with the block-level generator instead of re-deriving its constants.
No behaviour changes — a small convenience/DRY helper, not a new capability.

### Notes

- `includes.txt` updated so the function is exposed in the generated Java bindings.
- Deterministic (no `Xoroshiro` draw), so results are stable across a position's
  neighbourhood — the property area queries rely on.

### Verification

Checked against `getOreVeinBlockAt` over 7.27M positions for one seed: every
position that places a vein block (38,611 of them) classifies to the matching ore
type with `strength >= 0.4F` — zero mismatches. A wide coarse scan produces both
ore types (strength peaking ~1.3).

## Questions to settle in Discord first

1. **Is it even wanted?** It's a thin convenience over already-public noise — the
   maintainer may well prefer callers just sample `oreVeininess`. Float before opening
   a PR; a "no" costs nothing.
2. **Return shape (if yes):** currently returns the `OreVeins` enum + writes magnitude
   to `*strength`. He may prefer returning the raw signed `veininess` and letting the
   caller derive type/threshold.

## Discord opener (draft — will be rephrased before posting)

Post in xpple's Discord (discord.xpple.dev) with `docs/ore-vein-comparison.png` as the hero
image; keep the three singles (`docs/ore-vein-{none,density,footprint}.png`) in reserve.

Persona: **smart outsider, not fake insider.** Open by owning it — software/systems/perf
background, built with Claude Code, weak on worldgen internals. That makes every "naive"
question expected instead of embarrassing, and disarms the "did an AI write this" suspicion by
saying it first. Frame the questions in *your* language — empirical ("I just plotted what the
function returns") and optimization ("is this cheap proxy sound?") — never noise theory; you
can't defend jargon and they'll catch it. Keep the "holding it wrong" line deadpan
(Jobs/antennagate callback — don't explain it). Hold the `getOreVeinStrengthAt` offer back; only
if someone bites, mention it modestly — *"I wrote a little helper for the field bit — worth a PR,
or trivial?"*

> hey — built a Minecraft map viewer on top of your cubiomes fork. quick disclaimer: I'm coming
> at this from the software side — built it with Claude Code, solid on systems/perf, weak on the
> actual worldgen internals — so some of this is probably naive about the MC side.
>
> trying to surface ore veins for players, took two approaches (pics):
> 1. cheap per-chunk **"density"** — one cheap field sample per chunk
> 2. per-block **"footprint"** — actually walking `getOreVeinBlockAt` down every column
>
> two questions:
> - footprint comes back almost empty (3rd pic's barely different from no-overlay). I'm just
>   plotting whatever `getOreVeinBlockAt` returns — is that the real distribution and veins are
>   genuinely that sparse, or am I holding it wrong?
> - the density sample is obviously way cheaper than walking every block, and it *looks* like a
>   usable proxy for "is there a vein near here." is that a sound shortcut, or does the cheap field
>   diverge from real placement in ways that'll bite me?
