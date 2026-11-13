import { useEffect, useState } from 'react'
import { getChunk } from '../api.js'

export default function PassageModal({ source, onClose }) {
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    let alive = true
    getChunk(source.docId, source.chunkId).then((r) => {
      if (alive) setState(r.ok ? { chunk: r.data } : { error: r.data?.message ?? 'Could not load passage' })
    })
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      alive = false
      window.removeEventListener('keydown', onKey)
    }
  }, [source, onClose])

  return (
    <div className="modal" onClick={onClose} role="dialog" aria-modal="true" aria-label={source.sectionTitle}>
      <div className="card modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h3 style={{ margin: 0 }}>{source.sectionTitle}</h3>
            <div className="source-meta">
              {source.docTitle}
              {source.part ? ` · ${source.part}` : ''} · <span className="mono">{source.chunkId}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {state.loading && !state.chunk && !state.error && <p className="muted">Loading…</p>}
        {state.error && <p style={{ color: 'var(--bad)' }}>{state.error}</p>}
        {state.chunk && <pre>{state.chunk.text}</pre>}
        {state.chunk?.sourceFile && (
          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
            Source file: <span className="mono">{state.chunk.sourceFile}</span>
          </p>
        )}
      </div>
    </div>
  )
}
