import React from 'react'
import { useApp } from '../../App'
import { MC_VERSIONS } from '../../lib/constants'
import { ORE_FEATURE_DEFS } from '../../lib/oreFeatures'
import * as api from '../../lib/tauriAPI'
import ZoomVisibilityBadge from '../ZoomVisibilityBadge'
import { FOOTPRINT_MIN_ZOOM } from '../OreVeinLayer'
import { ORE_FEATURE_MIN_ZOOM } from '../OreFeatureLayer'

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
          {info && <span className="layer-info-badge" title={info} role="img" aria-label={info}>?</span>}
          {hotkey && <kbd className="shortcut-key" title={hotkeyTitle}>{hotkey}</kbd>}
        </span>
      )}
    </>
  )
}

export default function LayersFlyout() {
  const { state, dispatch, availableLayers } = useApp()

  const playerY = state.seedData?.playerY != null ? Math.floor(state.seedData.playerY) : null
  // Static export has no live player position at all — it drives Cave Mode
  // from baked presets (CaveMapControls) instead of a real player Y.
  const caveModeUnavailable = !api.IS_STATIC_SITE && state.seedData?.playerY == null
  // Not baked into this static export — always false live. See bugs-resolved.md.
  const notBaked = (key: keyof NonNullable<typeof availableLayers>) =>
    availableLayers != null && availableLayers[key] == null

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">Layers</span>
        <div className="flyout-header-actions">
          <button className="flyout-action-btn" onClick={() => dispatch({ type: 'RESET_OVERLAYS' })}>
            Reset
          </button>
        </div>
      </div>

      <div className="flyout-body">

        <div className="flyout-section-label">Surface</div>

        {/* Chunk Data — hidden (not disabled) when this export baked neither variant. See bugs-resolved.md. */}
        {state.worldDir && (!api.IS_STATIC_SITE || availableLayers?.chunk != null || availableLayers?.chunkHideWater != null) && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showChunkData}
                onChange={() => dispatch({ type: 'TOGGLE_CHUNK_DATA' })} />
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
                  <label className={`chunk-mode-option${state.hideWater ? ' active' : ''}${notBaked('chunkHideWater') ? ' disabled' : ''}`}
                    title={notBaked('chunkHideWater') ? 'Not available in this export' : undefined}>
                    <input type="checkbox" checked={state.hideWater}
                      disabled={notBaked('chunkHideWater')}
                      onChange={() => dispatch({ type: 'TOGGLE_HIDE_WATER' })} />
                    Hide Water <kbd className="shortcut-key" title="Toggle hide water">H</kbd>
                  </label>
                  <label className={`chunk-mode-option${state.caveMode ? ' active' : ''}${caveModeUnavailable || notBaked('cave') ? ' disabled' : ''}`}
                    title={caveModeUnavailable ? 'Open a world with a player position to use Cave Mode'
                      : notBaked('cave') ? 'Not available in this export' : undefined}>
                    <input type="checkbox" checked={state.caveMode}
                      disabled={caveModeUnavailable || notBaked('cave')}
                      onChange={() => dispatch({ type: 'TOGGLE_CAVE_MODE' })} />
                    Cave Mode <kbd className="shortcut-key" title="Toggle cave mode">C</kbd>
                    {state.caveMode && playerY != null && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>Y={playerY}</span>
                    )}
                  </label>
                </div>
                <OpacityRow label="Opacity" value={state.chunkOpacity}
                  onChange={v => dispatch({ type: 'SET_CHUNK_OPACITY', opacity: v })} />
              </>
            )}
          </div>
        )}

        <div className="flyout-layer-group">
          <label className="overlay-toggle">
            <input type="checkbox" checked={state.showBiomes}
              onChange={() => dispatch({ type: 'TOGGLE_BIOMES' })} />
            <LayerLabel
              name="Biomes"
              info="Seed-derived biome colors via cubiomes — no world file needed"
              hotkey="B"
              hotkeyTitle="Toggle biomes"
            />
          </label>
          {state.showBiomes && state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
            <div className="biome-mode-radio">
              {(['surface', 'underground'] as const).map(mode => {
                const disabled = mode === 'underground' && notBaked('underground')
                return (
                  <label key={mode} className={`biome-mode-option${state.biomeMode === mode ? ' active' : ''}`}
                    title={disabled ? 'Not available in this export' : undefined}>
                    <input type="radio" name="biomeMode" value={mode} checked={state.biomeMode === mode}
                      disabled={disabled}
                      onChange={() => dispatch({ type: 'SET_BIOME_MODE', mode })} />
                    {mode === 'surface' ? 'Surface' : 'Underground'}
                  </label>
                )
              })}
            </div>
          )}
          {state.showBiomes && (
            <OpacityRow label="Opacity" value={state.biomeOpacity}
              onChange={v => dispatch({ type: 'SET_BIOME_OPACITY', opacity: v })} />
          )}
        </div>

        {(state.dimension === 'overworld' ||
          (state.dimension === 'nether' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'])) && (
          <div className="flyout-section-label flyout-section-label--spaced">Underground</div>
        )}

        {state.dimension === 'overworld' && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showSlimeChunks}
                onChange={() => dispatch({ type: 'TOGGLE_SLIME_CHUNKS' })} />
              <LayerLabel
                name="Slime Chunks"
                info="Highlights the chunks where slimes can spawn naturally in overworld caves"
                hotkey="S"
                hotkeyTitle="Toggle slime chunks"
              />
            </label>
            {state.showSlimeChunks && (
              <OpacityRow label="Opacity" value={state.slimeOpacity}
                onChange={v => dispatch({ type: 'SET_SLIME_OPACITY', opacity: v })} />
            )}
          </div>
        )}

        {state.dimension === 'overworld' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle" title={notBaked('oreVeins') ? 'Not available in this export' : undefined}>
              <input type="checkbox" checked={state.showOreVeins} disabled={notBaked('oreVeins')}
                onChange={() => dispatch({ type: 'TOGGLE_ORE_VEINS' })} />
              <LayerLabel
                name="Ore Veins"
                info={`Copper (orange) and iron (gray) ore veins — overworld only, 1.18+. Per-column footprint, requires zoom ≥ ${FOOTPRINT_MIN_ZOOM}`}
                hotkey="V"
                hotkeyTitle="Toggle ore veins"
              />
              <ZoomVisibilityBadge checked={state.showOreVeins} currentZoom={state.zoom} minZoom={FOOTPRINT_MIN_ZOOM} />
            </label>
            {state.showOreVeins && (
              <>
                <div className="sub-toggles">
                  <label className="overlay-toggle sub-toggle">
                    <input type="checkbox" checked={state.showCopperVeins}
                      onChange={() => dispatch({ type: 'TOGGLE_COPPER_VEINS' })} />
                    <span className="overlay-label" style={{ color: 'rgb(210,140,60)' }}>Copper</span>
                  </label>
                  <label className="overlay-toggle sub-toggle">
                    <input type="checkbox" checked={state.showIronVeins}
                      onChange={() => dispatch({ type: 'TOGGLE_IRON_VEINS' })} />
                    <span className="overlay-label" style={{ color: 'rgb(180,180,180)' }}>Iron</span>
                  </label>
                </div>
                <OpacityRow label="Opacity" value={state.oreOpacity}
                  onChange={v => dispatch({ type: 'SET_ORE_OPACITY', opacity: v })} />
              </>
            )}
          </div>
        )}

        {/* Live-only — see bugs-resolved.md */}
        {state.dimension !== 'end' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle" title={notBaked('oreFeatures') ? 'Not available in this export' : undefined}>
              <input type="checkbox" checked={state.showOreFeatures} disabled={notBaked('oreFeatures')}
                onChange={() => dispatch({ type: 'TOGGLE_ORE_FEATURES' })} />
              <LayerLabel
                name="Ore Deposits"
                info={`Individual ore blobs from worldgen — overworld ores and nether ancient debris, 1.18+, requires zoom ≥ ${ORE_FEATURE_MIN_ZOOM}`}
              />
              <ZoomVisibilityBadge checked={state.showOreFeatures} currentZoom={state.zoom} minZoom={ORE_FEATURE_MIN_ZOOM} />
            </label>
            {state.showOreFeatures && (
              <div className="sub-toggles sub-toggles-grid">
                {ORE_FEATURE_DEFS.filter(ore => ore.dimension === state.dimension).map(ore => (
                  <label key={ore.id} className="overlay-toggle sub-toggle">
                    <input type="checkbox" checked={state.oreFeatureTypes.includes(ore.id)}
                      onChange={() => {
                        const set = new Set(state.oreFeatureTypes)
                        if (set.has(ore.id)) set.delete(ore.id); else set.add(ore.id)
                        dispatch({ type: 'SET_ORE_FEATURE_TYPES', ids: [...set] })
                      }} />
                    <span className="overlay-label" style={{ color: `rgb(${ore.color[0]},${ore.color[1]},${ore.color[2]})` }}>{ore.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* End has no carvers */}
        {state.dimension !== 'end' && MC_VERSIONS[state.selectedVersion] >= MC_VERSIONS['MC_1_18'] && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle" title={notBaked('carvers') ? 'Not available in this export' : undefined}>
              <input type="checkbox" checked={state.showCarvers} disabled={notBaked('carvers')}
                onChange={() => dispatch({ type: 'TOGGLE_CARVERS' })} />
              <LayerLabel
                name="Caves & Ravines"
                info="Carver coverage — overworld caves/ravines/canyons and nether caves, 1.18+"
              />
            </label>
            {state.showCarvers && (
              <OpacityRow label="Opacity" value={state.carverOpacity}
                onChange={v => dispatch({ type: 'SET_CARVER_OPACITY', opacity: v })} />
            )}
          </div>
        )}

        <div className="flyout-section-label flyout-section-label--spaced">Grids &amp; Reference</div>

        <div className="flyout-layer-group">
          <label className="overlay-toggle">
            <input type="checkbox" checked={state.showChunkGrid}
              onChange={() => dispatch({ type: 'TOGGLE_CHUNK_GRID' })} />
            <LayerLabel
              name="Chunk Grid (16)"
              info="Overlays the 16×16 block chunk boundary grid"
            />
          </label>
          <label className="overlay-toggle">
            <input type="checkbox" checked={state.showRegionGrid}
              onChange={() => dispatch({ type: 'TOGGLE_REGION_GRID' })} />
            <LayerLabel
              name="Region Grid (512)"
              info="Overlays the 512×512 block region file (.mca) boundary grid"
            />
          </label>
          {state.seedData?.playerX != null && (
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showSpawnRadius}
                onChange={() => dispatch({ type: 'TOGGLE_SPAWN_RADIUS' })} />
              <LayerLabel
                name="Spawn Radius"
                info="24-block no-spawn (block-accurate) and 128-block despawn radius around the player"
              />
            </label>
          )}
          {state.worldDir && state.dimension === 'overworld' && (
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showSpawnChunks}
                onChange={() => dispatch({ type: 'TOGGLE_SPAWN_CHUNKS' })} />
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
                onChange={() => dispatch({ type: 'TOGGLE_WORLD_BORDER' })} />
              <LayerLabel
                name="World Border"
                info="The world border set for this save — enforced identically in Overworld and Nether block coordinates"
              />
            </label>
          )}
        </div>

        {/* Local difficulty — static mode shows+disables via notBaked instead of live's worldTime gate. See bugs-resolved.md. */}
        {state.worldDir && (api.IS_STATIC_SITE || state.seedData?.worldTime != null) && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle" title={notBaked('localDifficulty') ? 'Not available in this export' : undefined}>
              <input type="checkbox" checked={state.showLocalDifficulty} disabled={notBaked('localDifficulty')}
                onChange={() => dispatch({ type: 'TOGGLE_LOCAL_DIFFICULTY' })} />
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
