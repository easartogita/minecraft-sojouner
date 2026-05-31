import React, { useState } from 'react'
import { useApp } from '../App'
import {
  CustomMarkerGroup,
  BE_TYPE_DEFS, ENTITY_TYPE_DEFS,
  BE_GROUP_DEFS, ENTITY_GROUP_DEFS,
  type BEFilterGroup, type EntityFilterGroup,
} from '../lib/markerFilters'

const PRESET_COLORS = [
  '#a0522d', '#8b0000', '#3b82f6', '#84cc16', '#7e22ce',
  '#d4a017', '#bf360c', '#06b6d4', '#ec4899', '#f97316',
  '#64748b', '#15803d', '#7c3aed', '#e11d48', '#0891b2',
]

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ── BE types grouped by render group ─────────────────────────────────────────

const BE_GROUPS_ORDER: BEFilterGroup[] = [
  'containers', 'spawners', 'signs', 'bees', 'utility', 'archeology', 'decorative', 'technical',
]

const BE_TYPES_BY_GROUP = new Map<BEFilterGroup, typeof BE_TYPE_DEFS>(
  BE_GROUPS_ORDER.map(g => [g, BE_TYPE_DEFS.filter(t => t.group === g)])
)

// ── Entity types grouped by render group ──────────────────────────────────────

const ENTITY_GROUPS_ORDER: EntityFilterGroup[] = [
  'villagers', 'mounts', 'pets', 'animals', 'livestock',
  'bosses', 'frames', 'armor_stands', 'containers', 'named_mobs',
]

const ENTITY_TYPES_BY_GROUP = new Map<EntityFilterGroup, typeof ENTITY_TYPE_DEFS>(
  ENTITY_GROUPS_ORDER.map(g => [g, ENTITY_TYPE_DEFS.filter(t => t.group === g)])
)

// ── Sub-section component ─────────────────────────────────────────────────────

function TypeSubSection({
  heading,
  headingColor,
  types,
  selected,
  onToggle,
  onSetAll,
}: {
  heading: string
  headingColor: string
  types: Array<{ type: string; label: string }>
  selected: string[]
  onToggle: (type: string) => void
  onSetAll: (next: string[]) => void
}) {
  const typeKeys = types.map(t => t.type)
  const allChecked = typeKeys.every(k => selected.includes(k))
  const someChecked = typeKeys.some(k => selected.includes(k))

  const toggleAll = () => {
    if (allChecked) {
      onSetAll(selected.filter(s => !typeKeys.includes(s)))
    } else {
      const toAdd = typeKeys.filter(k => !selected.includes(k))
      onSetAll([...selected, ...toAdd])
    }
  }

  return (
    <div className="mge-subsection">
      <div className="mge-subsection-header">
        <label className="mge-subsection-all">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
            onChange={toggleAll}
          />
          <span className="mge-subsection-dot" style={{ background: headingColor }} />
          <span className="mge-subsection-label">{heading}</span>
        </label>
      </div>
      <div className="mge-types-grid">
        {types.map(t => (
          <label key={t.type} className="mge-type-check">
            <input
              type="checkbox"
              checked={selected.includes(t.type)}
              onChange={() => onToggle(t.type)}
            />
            <span>{t.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MarkerGroupEditor({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp()
  const { markerGroupDefs } = state

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  const commitName = (id: string) => {
    const name = editingName.trim()
    if (name) dispatch({ type: 'UPDATE_MARKER_GROUP', id, changes: { name } } as never)
    setEditingId(null)
  }

  const startEdit = (g: CustomMarkerGroup) => {
    setEditingId(g.id)
    setEditingName(g.name)
  }

  const addGroup = () => {
    const id = randomId()
    const usedColors = new Set(markerGroupDefs.map(g => g.color))
    const color = PRESET_COLORS.find(c => !usedColors.has(c)) ?? PRESET_COLORS[0]
    const group: CustomMarkerGroup = { id, name: 'New Group', color, beTypes: [], entityTypes: [] }
    dispatch({ type: 'ADD_MARKER_GROUP', group } as never)
    setExpandedId(id)
    setEditingId(id)
    setEditingName('New Group')
  }

  const toggleBeType = (groupId: string, type: string, current: string[]) => {
    const beTypes = current.includes(type)
      ? current.filter(t => t !== type)
      : [...current, type]
    dispatch({ type: 'UPDATE_MARKER_GROUP', id: groupId, changes: { beTypes } } as never)
  }

  const toggleEntityType = (groupId: string, type: string, current: string[]) => {
    const entityTypes = current.includes(type)
      ? current.filter(t => t !== type)
      : [...current, type]
    dispatch({ type: 'UPDATE_MARKER_GROUP', id: groupId, changes: { entityTypes } } as never)
  }

  const setColor = (groupId: string, color: string) => {
    dispatch({ type: 'UPDATE_MARKER_GROUP', id: groupId, changes: { color } } as never)
  }

  const deleteGroup = (id: string) => {
    if (expandedId === id) setExpandedId(null)
    dispatch({ type: 'DELETE_MARKER_GROUP', id } as never)
  }

  const doReset = () => {
    dispatch({ type: 'RESET_MARKER_GROUPS' } as never)
    setConfirmReset(false)
    setExpandedId(null)
    setEditingId(null)
  }

  return (
    <div className="mge-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mge-dialog">
        <div className="mge-header">
          <span className="mge-title">Customize Marker Groups</span>
          <button className="mge-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="mge-body">
          <div className="mge-intro">
            Groups control which block entity and entity types appear on the map.
            Each type can belong to multiple groups.
          </div>

          <div className="mge-group-list">
            {(markerGroupDefs as CustomMarkerGroup[]).map(g => {
              const isExpanded = expandedId === g.id
              const isEditing  = editingId  === g.id
              const typeCount  = g.beTypes.length + g.entityTypes.length
              return (
                <div key={g.id} className={`mge-group${isExpanded ? ' expanded' : ''}`}>
                  <div className="mge-group-row">
                    <button className="mge-expand-btn" onClick={() => setExpandedId(isExpanded ? null : g.id)}
                      title={isExpanded ? 'Collapse' : 'Expand'}>
                      {isExpanded ? '▾' : '▸'}
                    </button>

                    <label className="mge-color-wrap" title="Change color">
                      <span className="mge-color-swatch" style={{ background: g.color }} />
                      <input type="color" className="mge-color-input" value={g.color}
                        onChange={e => setColor(g.id, e.target.value)} />
                    </label>

                    {isEditing ? (
                      <input
                        className="mge-name-input"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitName(g.id)
                          else if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => commitName(g.id)}
                        autoFocus
                      />
                    ) : (
                      <span className="mge-name" onClick={() => startEdit(g)} title="Click to rename">
                        {g.name}
                      </span>
                    )}

                    <span className="mge-type-counts">
                      {typeCount} type{typeCount !== 1 ? 's' : ''}
                    </span>

                    <button className="mge-delete-btn" onClick={() => deleteGroup(g.id)}
                      title="Delete group">✕</button>
                  </div>

                  {isExpanded && (
                    <div className="mge-types-panel">
                      <div className="mge-types-section">
                        <div className="mge-types-label">Block Entities</div>

                        <TypeSubSection
                          heading="Job Sites"
                          headingColor="#3b82f6"
                          types={[{ type: 'jobsite', label: 'Villager Job Sites (POI)' }]}
                          selected={g.beTypes}
                          onToggle={type => toggleBeType(g.id, type, g.beTypes)}
                          onSetAll={next => dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { beTypes: next } } as never)}
                        />

                        {BE_GROUPS_ORDER.map(grpKey => {
                          const types = BE_TYPES_BY_GROUP.get(grpKey) ?? []
                          const def = BE_GROUP_DEFS[grpKey]
                          return (
                            <TypeSubSection
                              key={grpKey}
                              heading={def.label}
                              headingColor={def.color}
                              types={types}
                              selected={g.beTypes}
                              onToggle={type => toggleBeType(g.id, type, g.beTypes)}
                              onSetAll={next => dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { beTypes: next } } as never)}
                            />
                          )
                        })}
                      </div>

                      <div className="mge-types-section">
                        <div className="mge-types-label">Entities</div>

                        {ENTITY_GROUPS_ORDER.map(grpKey => {
                          const types = ENTITY_TYPES_BY_GROUP.get(grpKey) ?? []
                          const def = ENTITY_GROUP_DEFS[grpKey]
                          return (
                            <TypeSubSection
                              key={grpKey}
                              heading={def.label}
                              headingColor={def.color}
                              types={types}
                              selected={g.entityTypes}
                              onToggle={type => toggleEntityType(g.id, type, g.entityTypes)}
                              onSetAll={next => dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { entityTypes: next } } as never)}
                            />
                          )
                        })}
                      </div>

                      <div className="mge-color-presets">
                        <span className="mge-types-label">Quick color</span>
                        <div className="mge-preset-swatches">
                          {PRESET_COLORS.map(c => (
                            <button key={c} className={`mge-preset-swatch${g.color === c ? ' active' : ''}`}
                              style={{ background: c }} onClick={() => setColor(g.id, c)} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mge-footer">
            <button className="btn-sm" onClick={addGroup}>+ Add Group</button>
            <div className="mge-footer-right">
              <button className="btn-sm" onClick={onClose}>Done</button>
              {confirmReset ? (<>
                <span className="mge-reset-confirm">Reset to defaults?</span>
                <button className="btn-sm mge-btn-danger" onClick={doReset}>Yes, reset</button>
                <button className="btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
              </>) : (
                <button className="btn-sm" onClick={() => setConfirmReset(true)}>Reset to Defaults</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
