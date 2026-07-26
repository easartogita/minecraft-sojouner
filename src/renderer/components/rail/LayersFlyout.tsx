import React from 'react'
import { useApp } from '../../App'
import { MC_VERSIONS } from '../../lib/constants'
import { ORE_FEATURE_DEFS } from '../../lib/oreFeatures'

function OpacityRow({ label, value, onChange }: {
  label: React.ReactNode; value: number; onChange: (v: number) => void
}) {
  return (
    <div className="opacity-inline-row">
      <span className="opacity-inline-label">{label}</span>
      <input type="range" min="0" max="1" step="0.05" value={value}
        onChange={e => onChange(parseFloat(e.target.value))} className="opacity-inline-slider" />
      <span className="opacity-inline-value">{Math.round(value * 100)}%</span>
    </div>
  )
}

function LayerLabel({ name, info, hotkey, hotkeyTitle }: {
  name: string
  info?: string
  hotkey?: string
  hotkeyTitle?: string
}) {
  return (
    <>
      <span className="overlay-label">{name}</span>
      {(info || hotkey) && (
        <span className="layer-label-meta">
          {info && <span className="layer-info-badge" title={info}>?</span>}
          {hotkey && <kbd className="shortcut-key" title={hotkeyTitle}>{hotkey}</kbd>}
        </span>
      )}
    </>
  )
}

export default function LayersFlyout() {
  const { state, dispatch } = useApp()

  const playerY = state.seedData?.playerY != null ? Math.floor(state.seedData.playerY) : null

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">Layers</span>
        <div className="flyout-header-actions">
          <button className="flyout-action-btn" onClick={() => dispatch({ type: 'RESET_OVERLAYS' } as never)}>
            Reset
          </button>
        </div>
      </div>

      <div className="flyout-body">

        <div className="flyout-section-label">Surface</div>

        {/* Chunk Data */}
        {state.worldDir && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showChunkData}
                onChange={() => dispatch({ type: 'TOGGLE_CHUNK_DATA' } as never)} />
              <LayerLabel
                name="Chunk Data"
                info="Your explored world: ghosted region outlines at low zoom, real block colors once past the chunk-data zoom threshold (see Settings)"
                hotkey="D"
                hotkeyTitle="Toggle chunk data"
              />
            </label>
            {state.showChunkData && (
              <>
                <div className="chunk-mode-row">
                  <label className={`chunk-mode-option${state.hideWater ? ' active' : ''}`}>
                    <input type="checkbox" checked={state.hideWater}
                      onChange={() => dispatch({ type: 'TOGGLE_HIDE_WATER' } as never)} />
                    Hide Water <kbd className="shortcut-key" title="Toggle hide water">H</kbd>
                  </label>
                  <label className={`chunk-mode-option${state.caveMode ? ' active' : ''}${state.seedData?.playerY == null ? ' disabled' : ''}`}
                    title={state.seedData?.playerY == null ? 'Open a world with a player position to use Cave Mode' : undefined}>
                    <input type="checkbox" checked={state.caveMode}
                      disabled={state.seedData?.playerY == null}
                      onChange={() => dispatch({ type: 'TOGGLE_CAVE_MODE' } as never)} />
                    Cave Mode <kbd className="shortcut-key" title="Toggle cave mode">C</kbd>
                    {state.caveMode && playerY != null && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>Y={playerY}</span>
                    )}
                  </label>
                </div>
                <OpacityRow label="Opacity" value={state.chunkOpacity}
                  onChange={v => dispatch({ type: 'SET_CHUNK_OPACITY', opacity: v } as never)} />
              </>
            )}
          </div>
        )}

        {/* Biomes */}
        <div className="flyout-layer-group">
          <label className="overlay-toggle">
            <input type="checkbox" checked={state.showBiomes}
              onChange={() => dispatch({ type: 'TOGGLE_BIOMES' } as never)} />
            <LayerLabel
              name="Biomes"
              info="Seed-derived biome colors via cubiomes — no world file needed"
              hotkey="B"
              hotkeyTitle="Toggle biomes"
            />
          </label>
          {state.showBiomes && state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
            <div className="biome-mode-radio">
              {(['surface', 'underground', 'deep'] as const).map(mode => (
                <label key={mode} className={`biome-mode-option${state.biomeMode === mode ? ' active' : ''}`}>
                  <input type="radio" name="biomeMode" value={mode} checked={state.biomeMode === mode}
                    onChange={() => dispatch({ type: 'SET_BIOME_MODE', mode } as never)} />
                  {mode === 'surface' ? 'Surface' : mode === 'underground' ? 'Cave' : 'Deep'}
                </label>
              ))}
            </div>
          )}
          {state.showBiomes && (
            <OpacityRow label="Opacity" value={state.biomeOpacity}
              onChange={v => dispatch({ type: 'SET_BIOME_OPACITY', opacity: v } as never)} />
          )}
        </div>

        {/* Terrain relief — overworld needs 1.18+ terrain noise; the End's
            surface height (mapEndSurfaceHeight) has no such floor. */}
        {(state.dimension === 'overworld'
          ? MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18']
          : state.dimension === 'end') && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showTerrain}
                onChange={() => dispatch({ type: 'TOGGLE_TERRAIN' } as never)} />
              <LayerLabel
                name="Terrain Relief"
                info="Hillshade from real surface heights — overworld 1.18+, or the End; high zoom only"
              />
            </label>
            {state.showTerrain && (
              <OpacityRow label="Opacity" value={state.terrainOpacity}
                onChange={v => dispatch({ type: 'SET_TERRAIN_OPACITY', opacity: v } as never)} />
            )}
          </div>
        )}

        {(state.dimension === 'overworld' ||
          (state.dimension === 'nether' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'])) && (
          <div className="flyout-section-label flyout-section-label--spaced">Underground</div>
        )}

        {/* Slime chunks */}
        {state.dimension === 'overworld' && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showSlimeChunks}
                onChange={() => dispatch({ type: 'TOGGLE_SLIME_CHUNKS' } as never)} />
              <LayerLabel
                name="Slime Chunks"
                info="Highlights the chunks where slimes can spawn naturally in overworld caves"
                hotkey="S"
                hotkeyTitle="Toggle slime chunks"
              />
            </label>
            {state.showSlimeChunks && (
              <OpacityRow label="Opacity" value={state.slimeOpacity}
                onChange={v => dispatch({ type: 'SET_SLIME_OPACITY', opacity: v } as never)} />
            )}
          </div>
        )}

        {/* Ore veins */}
        {state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showOreVeins}
                onChange={() => dispatch({ type: 'TOGGLE_ORE_VEINS' } as never)} />
              <LayerLabel
                name="Ore Veins"
                info="Copper (orange) and iron (gray) ore veins — overworld only, 1.18+"
                hotkey="V"
                hotkeyTitle="Toggle ore veins"
              />
            </label>
            {state.showOreVeins && (
              <>
                <div className="biome-mode-radio">
                  {(['density', 'footprint'] as const).map(m => (
                    <label key={m} className={`biome-mode-option${state.oreVeinMode === m ? ' active' : ''}`}>
                      <input type="radio" name="oreVeinMode" value={m} checked={state.oreVeinMode === m}
                        onChange={() => dispatch({ type: 'SET_ORE_VEIN_MODE', mode: m } as never)} />
                      {m === 'density' ? 'Density' : 'Footprint'}
                    </label>
                  ))}
                </div>
                <div className="sub-toggles">
                  <label className="overlay-toggle sub-toggle">
                    <input type="checkbox" checked={state.showCopperVeins}
                      onChange={() => dispatch({ type: 'TOGGLE_COPPER_VEINS' } as never)} />
                    <span className="overlay-label" style={{ color: 'rgb(210,140,60)' }}>Copper</span>
                  </label>
                  <label className="overlay-toggle sub-toggle">
                    <input type="checkbox" checked={state.showIronVeins}
                      onChange={() => dispatch({ type: 'TOGGLE_IRON_VEINS' } as never)} />
                    <span className="overlay-label" style={{ color: 'rgb(180,180,180)' }}>Iron</span>
                  </label>
                </div>
                <OpacityRow label="Opacity" value={state.oreOpacity}
                  onChange={v => dispatch({ type: 'SET_ORE_OPACITY', opacity: v } as never)} />
              </>
            )}
          </div>
        )}

        {/* Ore deposits (individual ore blobs) — overworld ores + nether ancient debris */}
        {state.dimension !== 'end' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showOreFeatures}
                onChange={() => dispatch({ type: 'TOGGLE_ORE_FEATURES' } as never)} />
              <LayerLabel
                name="Ore Deposits"
                info="Individual ore blobs from worldgen — overworld ores and nether ancient debris, 1.18+, high zoom only"
              />
            </label>
            {state.showOreFeatures && (
              <div className="sub-toggles sub-toggles-grid">
                {ORE_FEATURE_DEFS.filter(ore => ore.dimension === state.dimension).map(ore => (
                  <label key={ore.id} className="overlay-toggle sub-toggle">
                    <input type="checkbox" checked={state.oreFeatureTypes.includes(ore.id)}
                      onChange={() => {
                        const set = new Set(state.oreFeatureTypes)
                        if (set.has(ore.id)) set.delete(ore.id); else set.add(ore.id)
                        dispatch({ type: 'SET_ORE_FEATURE_TYPES', ids: [...set] } as never)
                      }} />
                    <span className="overlay-label" style={{ color: `rgb(${ore.color[0]},${ore.color[1]},${ore.color[2]})` }}>{ore.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Carvers (caves / ravines / canyons) — overworld + nether (End has none) */}
        {state.dimension !== 'end' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showCarvers}
                onChange={() => dispatch({ type: 'TOGGLE_CARVERS' } as never)} />
              <LayerLabel
                name="Caves & Ravines"
                info="Carver coverage — overworld caves/ravines/canyons and nether caves, 1.18+"
              />
            </label>
            {state.showCarvers && (
              <OpacityRow label="Opacity" value={state.carverOpacity}
                onChange={v => dispatch({ type: 'SET_CARVER_OPACITY', opacity: v } as never)} />
            )}
          </div>
        )}

        {/* Cave entrances */}
        {state.worldDir && state.dimension === 'overworld' && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showCaveEntrances}
                onChange={() => dispatch({ type: 'TOGGLE_CAVE_ENTRANCES' } as never)} />
              <LayerLabel
                name="Cave Entrances"
                info="Marks chunks where solid terrain dips well below the surface — cave openings, ravines, and overhangs. Requires chunk data zoom."
              />
            </label>
            {state.showCaveEntrances && (
              <OpacityRow label="Opacity" value={state.caveEntranceOpacity}
                onChange={v => dispatch({ type: 'SET_CAVE_ENTRANCE_OPACITY', opacity: v } as never)} />
            )}
          </div>
        )}

        <div className="flyout-section-label flyout-section-label--spaced">Grids &amp; Reference</div>

        {/* Grids + spawn radius */}
        <div className="flyout-layer-group">
          <label className="overlay-toggle">
            <input type="checkbox" checked={state.showChunkGrid}
              onChange={() => dispatch({ type: 'TOGGLE_CHUNK_GRID' } as never)} />
            <LayerLabel
              name="Chunk Grid (16)"
              info="Overlays the 16×16 block chunk boundary grid"
            />
          </label>
          <label className="overlay-toggle">
            <input type="checkbox" checked={state.showRegionGrid}
              onChange={() => dispatch({ type: 'TOGGLE_REGION_GRID' } as never)} />
            <LayerLabel
              name="Region Grid (512)"
              info="Overlays the 512×512 block region file (.mca) boundary grid"
            />
          </label>
          {state.seedData?.playerX != null && (
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showSpawnRadius}
                onChange={() => dispatch({ type: 'TOGGLE_SPAWN_RADIUS' } as never)} />
              <LayerLabel
                name="Spawn Radius"
                info="24-block no-spawn (block-accurate) and 128-block despawn radius around the player"
              />
            </label>
          )}
          {state.worldDir && state.dimension === 'overworld' && (
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showSpawnChunks}
                onChange={() => dispatch({ type: 'TOGGLE_SPAWN_CHUNKS' } as never)} />
              <LayerLabel
                name="Spawn Chunks"
                info="Always-loaded chunks around world spawn — (2r+1)² from the spawnChunkRadius gamerule (default 2)"
              />
            </label>
          )}
          {/* 60,000,000 is vanilla's untouched default — not a real border, nothing to draw */}
          {state.worldDir && state.dimension !== 'end' &&
           (state.seedData?.borderSize ?? 60_000_000) < 60_000_000 && (
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showWorldBorder}
                onChange={() => dispatch({ type: 'TOGGLE_WORLD_BORDER' } as never)} />
              <LayerLabel
                name="World Border"
                info="The world border set for this save — enforced identically in Overworld and Nether block coordinates"
              />
            </label>
          )}
        </div>

        {/* Local difficulty */}
        {state.worldDir && state.seedData?.worldTime != null && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showLocalDifficulty}
                onChange={() => dispatch({ type: 'TOGGLE_LOCAL_DIFFICULTY' } as never)} />
              <LayerLabel
                name="Local Difficulty"
                info="Regional difficulty (0–6.75) shown on hover — based on world time and chunk inhabitation"
              />
            </label>
          </div>
        )}

      </div>
    </div>
  )
}
