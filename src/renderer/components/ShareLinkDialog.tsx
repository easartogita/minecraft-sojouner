import React, { useMemo, useState } from 'react'
import { useApp } from '../App'
import type { Dimension } from '../lib/constants'
import { buildShareLink, extractShareLinkFilters } from '../lib/shareLink'

const DIM_LABEL: Record<Dimension, string> = {
  overworld: 'the Overworld',
  nether:    'the Nether',
  end:       'the End',
}

interface Props {
  x: number
  z: number
  dimension: Dimension
  zoom: number
  onClose: () => void
}

export default function ShareLinkDialog({ x, z, dimension, zoom, onClose }: Props) {
  const { state } = useApp()
  const [includeFilters, setIncludeFilters] = useState(false)
  const [copied, setCopied] = useState(false)

  const link = useMemo(
    () => buildShareLink(x, z, zoom, dimension, includeFilters ? extractShareLinkFilters(state) : null),
    [x, z, zoom, dimension, includeFilters, state],
  )

  const copy = async () => {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="site-export-modal-backdrop" role="dialog" aria-modal="true" aria-label="Copy link to here">
      <div className="site-export-modal">
        <h3>Copy link to here</h3>
        <p className="ws-hint">
          Opening this link jumps straight to {x}, {z} in {DIM_LABEL[dimension]} at this zoom level.
        </p>
        <input
          type="text"
          readOnly
          className="share-link-input"
          value={link}
          onFocus={e => e.currentTarget.select()}
        />
        <label className="ws-check-label" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={includeFilters}
            onChange={e => setIncludeFilters(e.target.checked)} />
          Include current filters (which layers are on, opacity, biome mode)
        </label>
        <div className="ws-btn-row">
          <button className="btn-sm" onClick={onClose}>Close</button>
          <button className="btn-sm btn-primary" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
        </div>
      </div>
    </div>
  )
}
