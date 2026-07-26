import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../../App'
import { useTileStats } from '../../hooks/useTileStats'
import { MC_VERSION_LABELS, MCVersionKey } from '../../lib/constants'
import { WorldType } from '../../hooks/useSeed'
import * as api from '../../lib/tauriAPI'
import { IconFolder, IconBolt, IconDice, IconExport } from '../icons'

const WORLD_TYPE_LABELS: Record<WorldType, string> = {
  default: 'Default', large_biomes: 'Large Biomes', amplified: 'Amplified',
  flat: 'Flat', single_biome: 'Single Biome', custom: 'Custom',
}

const WORLD_TYPE_CAVEAT: Partial<Record<WorldType, string>> = {
  flat: 'Structure positions are not meaningful in flat worlds.',
  single_biome: 'Structure positions may be inaccurate — biome filter is not respected.',
  custom: 'Custom generator detected — structure positions may be inaccurate.',
}

function timeAgo(secs: number): string {
  const diff = Math.floor(Date.now() / 1000 - secs)
  if (diff < 60)         return 'just now'
  if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)      return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7)  return `${Math.floor(diff / 86400)}d ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 604800)}w ago`
  return `${Math.floor(diff / 2592000)}mo ago`
}

export default function WorldFlyout({ onExport, onWorldSettings }: { onExport: () => void; onWorldSettings: () => void }) {
  const { state, dispatch, loadWorld, openLevelDat } = useApp()
  const { mcaLoadingCount } = useTileStats()

  const [showAllSaves, setShowAllSaves] = useState(false)
  const [copied, setCopied] = useState(false)
  const dotRef = useRef<HTMLDivElement>(null)
  const prevUpdateRef = useRef(0)
  const [savesWorlds, setSavesWorlds] = useState<api.SavesWorldEntry[] | null>(null)

  const [manualSeed, setManualSeed] = useState('')
  const [manualVersion, setManualVersion] = useState<MCVersionKey>('MC_1_21')
  const [manualWorldType, setManualWorldType] = useState<WorldType>('default')
  const [manualError, setManualError] = useState<string | null>(null)
  // "From seed…" reveal in the loaded-world state (the no-world state shows
  // seed entry permanently)
  const [showSeedEntry, setShowSeedEntry] = useState(false)
  const [showGameRules, setShowGameRules] = useState(false)

  useEffect(() => {
    api.listSavesWorlds().then(setSavesWorlds).catch(() => setSavesWorlds([]))
  }, [])

  useEffect(() => {
    if (state.lastUpdate !== prevUpdateRef.current && state.lastUpdate > 0) {
      prevUpdateRef.current = state.lastUpdate
      const dot = dotRef.current
      if (!dot) return
      dot.classList.remove('pulse')
      void dot.offsetWidth
      dot.classList.add('pulse')
    }
  }, [state.lastUpdate])

  const copySeed = async () => {
    if (!state.seedData?.seed) return
    await navigator.clipboard.writeText(state.seedData.seed)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleManualSeed = () => {
    const trimmed = manualSeed.trim()
    if (!trimmed) return
    try {
      BigInt(trimmed)
      setManualError(null)
      dispatch({ type: 'SET_MANUAL_SEED', seed: trimmed, version: manualVersion, worldType: manualWorldType } as never)
    } catch {
      setManualError('Invalid seed — enter a signed 64-bit integer')
    }
  }

  const randomizeSeed = () => {
    const arr = new BigInt64Array(1)
    crypto.getRandomValues(arr)
    const seed = arr[0].toString()
    setManualSeed(seed)
    setManualError(null)
    dispatch({ type: 'SET_MANUAL_SEED', seed, version: manualVersion, worldType: manualWorldType } as never)
  }

  const openWorld = async (path: string) => {
    try { await loadWorld(path) } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) } as never)
    }
  }

  const browseWorldFolder = async () => {
    const path = await api.selectWorldDir()
    if (path) await openWorld(path)
  }

  const fileName = state.levelDatPath
    ? state.levelDatPath.split('/').slice(-3).join('/')
    : null

  // Shared seed-entry block: input + dice, version/world-type, Load.
  const seedEntry = (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <input
          type="text"
          className="seed-manual-input"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="Seed"
          value={manualSeed}
          onChange={e => { setManualSeed(e.target.value); setManualError(null) }}
          onKeyDown={e => e.key === 'Enter' && handleManualSeed()}
        />
        <button className="btn-sm btn-sm--icon" onClick={randomizeSeed} title="Random seed"><IconDice /></button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <select className="version-select" style={{ flex: 1 }} value={manualVersion}
          onChange={e => setManualVersion(e.target.value as MCVersionKey)}>
          {MC_VERSION_LABELS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
        <select className="version-select" style={{ flex: 1 }} value={manualWorldType}
          onChange={e => setManualWorldType(e.target.value as WorldType)}>
          <option value="default">Default</option>
          <option value="large_biomes">Large Biomes</option>
          <option value="amplified">Amplified</option>
        </select>
      </div>
      <button className="btn-primary" onClick={handleManualSeed} style={{ width: '100%' }}>Load</button>
      {manualError && <div style={{ fontSize: 10, color: '#c0392b', marginTop: 4 }}>{manualError}</div>}
    </>
  )

  const isBedrockWorld = state.seedData?.edition === 'bedrock'
  // "vanilla" is the standard singleplayer brand; anything else is worth flagging
  // since cubiomes predictions assume vanilla worldgen.
  const nonVanillaBrands = (state.seedData?.serverBrands ?? []).filter(b => b.toLowerCase() !== 'vanilla')
  const gameRuleEntries = Object.entries(state.seedData?.gameRules ?? {}).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="flyout-panel">
      <div className="flyout-header">
        <span className="flyout-title">World</span>
      </div>

      <div className="flyout-body">
        {state.seedData ? (
          <>
            <div className="flyout-seed-row">
              <div className="seed-value" title="Click to copy seed" onClick={copySeed} style={{ cursor: 'pointer', flex: 1 }}>
                {copied ? '✓ Copied!' : state.seedData.seed}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {mcaLoadingCount > 0 && <div className="mca-dot" title="Reading region files…" />}
                {state.isWatching && <div ref={dotRef} className="live-dot" title="Live watching" />}
              </div>
            </div>

            {fileName && (
              <div className="seed-path" title={state.levelDatPath ?? ''} style={{ marginBottom: 8 }}>
                <IconFolder className="icon-inline" /> {fileName}
              </div>
            )}

            {isBedrockWorld ? (
              <div className="flyout-row" style={{ marginBottom: 6 }}>
                <span className="world-type-badge" style={{ background: 'rgba(255,180,0,0.15)', color: '#ffb400', border: '1px solid rgba(255,180,0,0.3)' }}>
                  Bedrock
                </span>
                {state.seedData.versionName && (
                  <span className="version-detected">{state.seedData.versionName}</span>
                )}
              </div>
            ) : (
              <>
                <div className="flyout-row" style={{ marginBottom: 6 }}>
                  <select
                    className="version-select version-select--inline"
                    value={state.selectedVersion}
                    onChange={e => dispatch({ type: 'SET_VERSION', version: e.target.value as MCVersionKey } as never)}
                    title={state.seedData.versionName ? `Detected: ${state.seedData.versionName}` : 'Minecraft version'}
                  >
                    {MC_VERSION_LABELS.map(({ key, label }) => (
                      <option key={key} value={key}>Java {label}</option>
                    ))}
                  </select>
                  {state.seedData.versionName && (
                    <span className="version-detected">({state.seedData.versionName})</span>
                  )}
                </div>

                {(['flat', 'single_biome', 'custom'] as WorldType[]).includes(state.worldType) ? (
                  <div style={{ marginBottom: 6 }}>
                    <span
                      className={`world-type-badge world-type-badge--${state.worldType}`}
                      title={WORLD_TYPE_CAVEAT[state.worldType] ?? `World type: ${WORLD_TYPE_LABELS[state.worldType]}`}
                    >
                      {WORLD_TYPE_LABELS[state.worldType]}
                      {WORLD_TYPE_CAVEAT[state.worldType] && ' ⚠'}
                    </span>
                  </div>
                ) : (
                  <div className="flyout-row" style={{ marginBottom: 6 }}>
                    <select
                      className="version-select version-select--inline"
                      value={state.worldType}
                      onChange={e => dispatch({ type: 'SET_WORLD_TYPE', worldType: e.target.value as WorldType } as never)}
                      title="World type affects biome and structure generation"
                    >
                      <option value="default">Default</option>
                      <option value="large_biomes">Large Biomes</option>
                      <option value="amplified">Amplified</option>
                    </select>
                  </div>
                )}
              </>
            )}

            {nonVanillaBrands.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span className="server-brand-badge"
                  title={`Server brand${nonVanillaBrands.length > 1 ? 's' : ''}: ${nonVanillaBrands.join(', ')} — cubiomes predictions assume vanilla worldgen and may not match a modded server`}>
                  ⚠ {nonVanillaBrands.join(', ')}
                </span>
              </div>
            )}

            {gameRuleEntries.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div className="recent-worlds-more" onClick={() => setShowGameRules(v => !v)}>
                  {showGameRules ? 'hide game rules' : `game rules (${gameRuleEntries.length})…`}
                </div>
                {showGameRules && (
                  <div className="game-rules-list">
                    {gameRuleEntries.map(([rule, value]) => (
                      <div key={rule} className="game-rules-row">
                        <span className="game-rules-name">{rule}</span>
                        <span className="game-rules-value">{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flyout-world-actions">
              <button className="flyout-world-action-btn" onClick={onExport} title="Export the visible map area as a TIFF image">
                <IconExport className="icon-inline" /> Export TIFF
              </button>
              <button className="flyout-world-action-btn" onClick={onWorldSettings} title="Pre-generate tile cache and world settings">
                <IconBolt className="icon-inline" /> Pre-generate
              </button>
            </div>

            {savesWorlds && savesWorlds.length > 0 && (
              <div className="recent-worlds">
                <div className="recent-worlds-title">My Worlds</div>
                {(showAllSaves ? savesWorlds : savesWorlds.slice(0, 5))
                  .filter(w => w.levelDatPath !== state.levelDatPath)
                  .map(w => (
                    <div key={w.levelDatPath} className="recent-world-item saves-world-row" onClick={() => openWorld(w.levelDatPath)} title={w.levelDatPath}>
                      <span>{w.name}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {w.edition === 'bedrock' && <span className="edition-badge edition-badge--bedrock">Bedrock</span>}
                        <span className="saves-world-row-time">{timeAgo(w.modifiedSecs)}</span>
                      </span>
                    </div>
                  ))}
                {savesWorlds.length > 5 && (
                  <div className="recent-worlds-more" onClick={() => setShowAllSaves(v => !v)}>
                    {showAllSaves ? 'show less' : `${savesWorlds.length - 5} more…`}
                  </div>
                )}
                <div className="recent-worlds-more" onClick={browseWorldFolder}>Browse…</div>
                <div className="recent-worlds-more" onClick={() => setShowSeedEntry(v => !v)}>From seed…</div>
              </div>
            )}
            {(!savesWorlds || savesWorlds.length === 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <button className="btn-sm" onClick={browseWorldFolder}>Change world</button>
                <button className="btn-sm" onClick={() => setShowSeedEntry(v => !v)}>From seed…</button>
              </div>
            )}
            {showSeedEntry && <div style={{ marginTop: 6 }}>{seedEntry}</div>}
          </>
        ) : (
          <>
            {savesWorlds && savesWorlds.length > 0 ? (
              <div className="recent-worlds" style={{ marginBottom: 8 }}>
                <div className="recent-worlds-title">My Worlds</div>
                {(showAllSaves ? savesWorlds : savesWorlds.slice(0, 5)).map(w => (
                  <div key={w.levelDatPath} className="recent-world-item saves-world-row" onClick={() => openWorld(w.levelDatPath)} title={w.levelDatPath}>
                    <span>{w.name}</span>
                    <span className="saves-world-row-time">{timeAgo(w.modifiedSecs)}</span>
                  </div>
                ))}
                {savesWorlds.length > 5 && (
                  <div className="recent-worlds-more" onClick={() => setShowAllSaves(v => !v)}>
                    {showAllSaves ? 'show less' : `${savesWorlds.length - 5} more…`}
                  </div>
                )}
                <div className="recent-worlds-more" onClick={browseWorldFolder}>Browse…</div>
              </div>
            ) : (
              <button className="btn-primary" onClick={browseWorldFolder} style={{ width: '100%', marginBottom: 10 }}>
                Open world folder
              </button>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Or enter a seed:</div>
            {seedEntry}
          </>
        )}
      </div>
    </div>
  )
}
