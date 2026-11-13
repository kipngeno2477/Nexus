import { useCallback, useEffect, useState } from 'react'
import { listDocuments, listChunks, uploadDocument } from '../api.js'

function DocCard({ doc }) {
  const [chunks, setChunks] = useState(null)
  const [open, setOpen] = useState(false)

  async function toggle() {
    setOpen((o) => !o)
    if (!chunks) {
      const r = await listChunks(doc.docId)
      setChunks(r.ok ? r.data.chunks : [])
    }
  }

  return (
    <div className="card doc">
      <div className="doc-title">{doc.title}</div>
      <div className="source-meta">
        <span className="mono">{doc.docId}</span> · {doc.file} · {doc.chunks} chunks
        {doc.uploaded && ' · uploaded'}
      </div>
      <div className="source-actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-sm" onClick={toggle}>
          {open ? 'Hide sections' : 'Show sections'}
        </button>
        {doc.sourceUrl && (
          <a className="btn btn-sm" href={doc.sourceUrl} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        )}
      </div>
      {open && (
        <div className="chunk-list">
          {!chunks && <p className="muted">Loading…</p>}
          {chunks?.map((c) => (
            <div className="chunk-row" key={c.chunkId}>
              <span>{c.sectionTitle}</span>
              <span className="mono muted">
                {c.chunkId} · {c.words}w
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UploadForm({ onUploaded }) {
  const [fileName, setFileName] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 900_000) return setMsg({ bad: true, text: 'File is too large (max ~900 KB).' })
    setFileName(f.name)
    setText(await f.text())
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const r = await uploadDocument({ fileName, title: title || undefined, text })
    setBusy(false)
    if (r.ok) {
      setMsg({ text: `Added "${r.data.doc.title}": ${r.data.doc.chunks} chunks indexed.` })
      setFileName('')
      setTitle('')
      setText('')
      onUploaded()
    } else setMsg({ bad: true, text: r.data?.message ?? 'Upload failed' })
  }

  return (
    <form className="card doc form-grid" onSubmit={submit}>
      <div className="doc-title">Add a plain-text document</div>
      <input type="file" accept=".txt,.md,text/plain" onChange={onFile} aria-label="Choose a .txt file" />
      <input placeholder="File name (e.g. county-waste-bylaw.txt)" value={fileName} onChange={(e) => setFileName(e.target.value)} required />
      <input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea placeholder="…or paste the text here" value={text} onChange={(e) => setText(e.target.value)} required />
      <div className="source-actions">
        <button className="btn btn-primary btn-sm" disabled={busy || !fileName || !text.trim()}>
          {busy ? 'Ingesting…' : 'Ingest document'}
        </button>
        {msg && <span style={{ fontSize: 13.5, color: msg.bad ? 'var(--bad)' : 'var(--ok)' }}>{msg.text}</span>}
      </div>
    </form>
  )
}

export default function KnowledgeBase({ onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(
    () =>
      listDocuments().then((r) => {
        if (r.ok) setData(r.data)
        else setError(r.data?.message ?? 'Could not load documents')
      }),
    []
  )

  useEffect(() => {
    listDocuments().then((r) => {
      if (r.ok) setData(r.data)
      else setError(r.data?.message ?? 'Could not load documents')
    })
  }, [])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Knowledge base">
        <div className="drawer-head">
          <h3>Knowledge base</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
          Answers come only from these documents. Each is cleaned, split into sections and indexed when the server starts.
        </p>
        {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}
        {data && (
          <>
            <p style={{ fontSize: 14 }}>
              {data.docs.length} document{data.docs.length === 1 ? '' : 's'} · {data.totalChunks} chunks
            </p>
            {data.docs.map((d) => (
              <DocCard key={d.docId} doc={d} />
            ))}
            {data.uploadsEnabled && (
              <UploadForm
                onUploaded={() => {
                  load()
                  onChanged?.()
                }}
              />
            )}
          </>
        )}
      </aside>
    </div>
  )
}
