import React, { useState } from 'react'
import { useApp } from '../../App'
import {
  CustomMarkerGroup,
  BE_TYPE_DEFS, ENTITY_TYPE_DEFS,
  BE_GROUP_DEFS, ENTITY_GROUP_DEFS,
  type BEFilterGroup, type EntityFilterGroup,
} from '../../lib/markerFilters'

export const PRESET_COLORS = [
  '#a0522d', '#8b0000', '#3b82f6', '#84cc16', '#7e22ce',
  '#d4a017', '#bf360c', '#06b6d4', '#ec4899', '#f97316',
  '#64748b', '#15803d', '#7c3aed', '#e11d48', '#0891b2',
]

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// BE types grouped by render group

const BE_GROUPS_ORDER: BEFilterGroup[] = [
  'containers', 'spawners', 'signs', 'bees', 'utility', 'archeology', 'decorative', 'technical',
]

const BE_TYPES_BY_GROUP = new Map<BEFilterGroup, typeof BE_TYPE_DEFS>(
  BE_GROUPS_ORDER.map(g => [g, BE_TYPE_DEFS.filter(t => t.group === g)])
)

// Entity types grouped by render group

const ENTITY_GROUPS_ORDER: EntityFilterGroup[] = [
  'villagers', 'mounts', 'pets', 'animals', 'livestock',
  'bosses', 'frames', 'armor_stands', 'containers', 'named_mobs', 'uncategorized',
]

const ENTITY_TYPES_BY_GROUP = new Map<EntityFilterGroup, typeof ENTITY_TYPE_DEFS>(
  ENTITY_GROUPS_ORDER.map(g => [g, ENTITY_TYPE_DEFS.filter(t => t.group === g)])
)

// Sub-section component

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
    <div className="mgr-subsection">
      <div className="mgr-subsection-header">
        <label className="mgr-subsection-all">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
            onChange={toggleAll}
          />
          <span className="mgr-subsection-dot" style={{ background: headingColor }} />
          <span className="mgr-subsection-label">{heading}</span>
        </label>
      </div>
      <div className="mgr-types-grid">
        {types.map(t => (
          <label key={t.type} className="mgr-type-check">
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

// Group row: visibility toggle + inline editor

/**
 * One marker group in the World Data panel: the collapsed row combines the
 * visibility checkbox (SET_MARKER_GROUP) with the editing affordances that
 * used to live in the MarkerGroupEditor modal; expanding it reveals the full
 * color/name/type-membership editor in place.
 */
export default function MarkerGroupRow({
  group: g, enabled, expanded, onToggleEnabled, onToggleExpanded,
}: {
  group: CustomMarkerGroup
  enabled: boolean
  expanded: boolean
  onToggleEnabled: () => void
  onToggleExpanded: () => void
}) {
  const { dispatch } = useApp()

  const [editing, setEditing] = useState(false)
  const [editingName, setEditingName] = useState('')

  const commitName = () => {
    const name = editingName.trim()
    if (name) dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { name } })
    setEditing(false)
  }

  const startEdit = () => {
    setEditing(true)
    setEditingName(g.name)
  }

  const toggleBeType = (type: string) => {
    const beTypes = g.beTypes.includes(type)
      ? g.beTypes.filter(t => t !== type)
      : [...g.beTypes, type]
    dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { beTypes } })
  }

  const toggleEntityType = (type: string) => {
    const entityTypes = g.entityTypes.includes(type)
      ? g.entityTypes.filter(t => t !== type)
      : [...g.entityTypes, type]
    dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { entityTypes } })
  }

  const setColor = (color: string) => {
    dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { color } })
  }

  const typeCount = g.beTypes.length + g.entityTypes.length

  return (
    <div className={`mgr-group${expanded ? ' expanded' : ''}`}
      style={{ '--group-color': g.color } as React.CSSProperties}>
      <div className="mgr-group-row">
        <input type="checkbox" className="mgr-enable-check" checked={enabled}
          title="Show this group on the map"
          onChange={onToggleEnabled} />

        <label className="mgr-color-wrap" title="Change color">
          <span className="mgr-color-swatch" style={{ background: g.color }} />
          <input type="color" className="mgr-color-input" value={g.color}
            onChange={e => setColor(e.target.value)} />
        </label>

        {editing ? (
          <input
            className="mgr-name-input"
            value={editingName}
            onChange={e => setEditingName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitName()
              else if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={commitName}
            autoFocus
          />
        ) : (
          <span className="mgr-name" onClick={startEdit} title="Click to rename">
            {g.name}
          </span>
        )}

        <span className="mgr-type-counts">
          {typeCount} type{typeCount !== 1 ? 's' : ''}
        </span>

        <button className="mgr-delete-btn" title="Delete group"
          onClick={() => dispatch({ type: 'DELETE_MARKER_GROUP', id: g.id })}>✕</button>

        <button className="mgr-expand-btn" onClick={onToggleExpanded}
          title={expanded ? 'Collapse' : 'Edit group'}>
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {expanded && (
        <div className="mgr-types-panel">
          <div className="mgr-types-section">
            <div className="mgr-types-label">Block Entities</div>

            <TypeSubSection
              heading="Job Sites"
              headingColor="#3b82f6"
              types={[{ type: 'jobsite', label: 'Villager Job Sites (POI)' }]}
              selected={g.beTypes}
              onToggle={toggleBeType}
              onSetAll={next => dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { beTypes: next } })}
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
                  onToggle={toggleBeType}
                  onSetAll={next => dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { beTypes: next } })}
                />
              )
            })}
          </div>

          <div className="mgr-types-section">
            <div className="mgr-types-label">Entities</div>

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
                  onToggle={toggleEntityType}
                  onSetAll={next => dispatch({ type: 'UPDATE_MARKER_GROUP', id: g.id, changes: { entityTypes: next } })}
                />
              )
            })}
          </div>

          <div className="mgr-color-presets">
            <span className="mgr-types-label">Quick color</span>
            <div className="mgr-preset-swatches">
              {PRESET_COLORS.map(c => (
                <button key={c} className={`mgr-preset-swatch${g.color === c ? ' active' : ''}`}
                  style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
