import React from 'react'
import { useApp } from '../../App'
import { MC_VERSIONS, CAVE_MODE_MIN_ZOOM, CAVE_MODE_MAX_ZOOM } from '../../lib/constants'

const SCAN_LOW_MIN  = -80
const SCAN_HIGH_MAX =  20
const STEP          =  10

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
    <span className="overlay-label">
      {name}
      {info && <span className="layer-info-badge" title={info}>?</span>}
      {hotkey && <kbd className="shortcut-key" title={hotkeyTitle}>{hotkey}</kbd>}
    </span>
  )
}

export default function LayersFlyout() {
  const { state, dispatch, mapRef } = useApp()

  const playerY = state.seedData?.playerY != null ? Math.floor(state.seedData.playerY) : null
  const { caveScanLow, caveScanHigh, zoom } = state

  const ceilingY = playerY != null ? playerY + caveScanHigh : null
  const floorY   = playerY != null ? playerY + caveScanLow  : null

  const setZoom = (z: number) => {
    const clamped = Math.max(CAVE_MODE_MIN_ZOOM, Math.min(CAVE_MODE_MAX_ZOOM, z))
    dispatch({ type: 'SET_ZOOM', zoom: clamped } as never)
    mapRef.current?.setZoom(clamped)
  }

  const setRange = (low: number, high: number) =>
    dispatch({ type: 'SET_CAVE_SCAN_RANGE', low, high } as never)

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

        {/* Chunk Data */}
        {state.worldDir && (
          <div className="flyout-layer-group">
            <label className="overlay-toggle">
              <input type="checkbox" checked={state.showChunkData}
                onChange={() => dispatch({ type: 'TOGGLE_CHUNK_DATA' } as never)} />
              <LayerLabel
                name="Chunk Data"
                info="Real block colors rendered from .mca region files — visible at close zoom (≥ 3)"
                hotkey="D"
                hotkeyTitle="Toggle chunk data"
              />
            </label>
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
          </div>
        )}

        {/* Cave scan controls — inline when cave mode is active */}
        {state.caveMode && (
          <div className="flyout-cave-scan">
            <div className="cave-sb-zoom-row">
              <span className="cave-sb-label">Cave Zoom</span>
              <button className="btn-sm" onClick={() => setZoom(zoom - 1)} disabled={zoom <= CAVE_MODE_MIN_ZOOM}>−</button>
              <span className="cave-sb-zoom-val">{zoom}</span>
              <button className="btn-sm" onClick={() => setZoom(zoom + 1)} disabled={zoom >= CAVE_MODE_MAX_ZOOM}>+</button>
            </div>
            <div className="cave-sb-table">
              <div className="cave-sb-row cave-sb-row--ceiling">
                <span className="cave-sb-row-label">Ceiling</span>
                <span className="cave-sb-y">{ceilingY != null ? `Y ${ceilingY}` : `+${caveScanHigh}`}</span>
                <div className="cave-sb-btns">
                  <button className="btn-sm" disabled={caveScanHigh >= SCAN_HIGH_MAX} title="Raise ceiling"
                    onClick={() => setRange(caveScanLow, Math.min(SCAN_HIGH_MAX, caveScanHigh + STEP))}>▲</button>
                  <button className="btn-sm" disabled={caveScanHigh <= caveScanLow + STEP} title="Lower ceiling"
                    onClick={() => setRange(caveScanLow, Math.max(caveScanLow + STEP, caveScanHigh - STEP))}>▼</button>
                </div>
              </div>
              <div className="cave-sb-row cave-sb-row--player">
                <span className="cave-sb-row-label">Player</span>
                <span className="cave-sb-y">{playerY != null ? `Y ${playerY}` : '—'}</span>
              </div>
              <div className="cave-sb-row cave-sb-row--floor">
                <span className="cave-sb-row-label">Floor</span>
                <span className="cave-sb-y">{floorY != null ? `Y ${floorY}` : `${caveScanLow}`}</span>
                <div className="cave-sb-btns">
                  <button className="btn-sm" disabled={caveScanLow >= caveScanHigh - STEP} title="Raise floor"
                    onClick={() => setRange(Math.min(caveScanLow + STEP, caveScanHigh - STEP), caveScanHigh)}>▲</button>
                  <button className="btn-sm" disabled={caveScanLow <= SCAN_LOW_MIN} title="Lower floor"
                    onClick={() => setRange(Math.max(SCAN_LOW_MIN, caveScanLow - STEP), caveScanHigh)}>▼</button>
                </div>
              </div>
            </div>
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
          <OpacityRow label="Opacity" value={state.biomeOpacity}
            onChange={v => dispatch({ type: 'SET_BIOME_OPACITY', opacity: v } as never)} />
        </div>

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
            <OpacityRow label="Opacity" value={state.slimeOpacity}
              onChange={v => dispatch({ type: 'SET_SLIME_OPACITY', opacity: v } as never)} />
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
            )}
            <OpacityRow label="Opacity" value={state.oreOpacity}
              onChange={v => dispatch({ type: 'SET_ORE_OPACITY', opacity: v } as never)} />
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
                info="24-block no-spawn and 128-block despawn radius circles around the player"
              />
            </label>
          )}
        </div>

      </div>
    </div>
  )
}
