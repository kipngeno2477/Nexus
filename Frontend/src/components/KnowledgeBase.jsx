import { useCallback, useEffect, useState } from 'react'
import { listDocuments, listChunks, uploadDocument, deleteDocument } from '../api.js'
import IngestReport from './IngestReport.jsx'

const TOKEN_KEY = 'nexus-upload-token'
function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}
function saveToken(t) {
  try {
    sessionStorage.setItem(TOKEN_KEY, t)
  } catch {
    /* storage unavailable: token just isn't remembered */
  }
}

function DocCard({ doc, canDelete, onDelete }) {
  const [chunks, setChunks] = useState(null)
  const [open, setOpen] = useState(null) // 'sections' | 'report' | null
  const [confirming, setConfirming] = useState(false)

  async function showSections() {
    setOpen((o) => (o === 'sections' ? null : 'sections'))
    if (!chunks) {
      const r = await listChunks(doc.docId)
      setChunks(r.ok ? r.data.chunks : [])
    }
  }

  return (
    <div className="card doc">
      <div className="doc-title">
        {doc.title} {doc.uploaded && <span className="tag">uploaded</span>}
      </div>
      <div className="source-meta">
        <span className="mono">{doc.docId}</span> · {doc.file} · {doc.chunks} chunks
      </div>
      <div className="source-actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-sm" onClick={showSections}>
          {open === 'sections' ? 'Hide sections' : 'Sections'}
        </button>
        {doc.ingest && (
          <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => (o === 'report' ? null : 'report'))}>
            {open === 'report' ? 'Hide report' : 'Ingestion report'}
          </button>
        )}
        {doc.sourceUrl && (
          <a className="btn btn-sm" href={doc.sourceUrl} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        )}
        {canDelete && doc.uploaded && !confirming && (
          <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--bad)' }} onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
        {confirming && (
          <>
            <span style={{ fontSize: 13 }}>Remove this document?</span>
            <button type="button" className="btn btn-sm" style={{ color: 'var(--bad)' }} onClick={() => onDelete(doc)}>
              Yes, remove
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
      {open === 'report' && <IngestReport report={doc.ingest} />}
      {open === 'sections' && (
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

function UploadForm({ token, onUploaded }) {
  const [fileName, setFileName] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState(null)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 900_000) return setMsg({ bad: true, text: 'File is too large (max ~900 KB).' })
    setFileName(f.name.replace(/[^\w .()-]/g, '_'))
    setText(await f.text())
    setMsg(null)
    setReport(null)
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    setReport(null)
    const r = await uploadDocument({ fileName, title: title.trim() || undefined, text }, token)
    setBusy(false)
    if (r.ok) {
      setMsg({ text: `Added “${r.data.doc.title}”. It can be searched now.` })
      setReport(r.data.report)
      setFileName('')
      setTitle('')
      setText('')
      onUploaded()
    } else setMsg({ bad: true, text: r.data?.message ?? 'Upload failed' })
  }

  return (
    <form className="card doc form-grid" onSubmit={submit}>
      <div className="doc-title">Add a document</div>
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
        Plain text (.txt or .md), up to ~900 KB. Messy text is fine: page numbers, running headers, broken hyphenation and
        stray spacing are cleaned automatically. The original is stored unchanged.
      </p>
      <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} aria-label="Choose a .txt or .md file" />
      <input placeholder="File name (e.g. county-waste-bylaw.txt)" value={fileName} onChange={(e) => setFileName(e.target.value)} required />
      <input placeholder="Title (optional; otherwise taken from the first line)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
      <textarea placeholder="…or paste the text here" value={text} onChange={(e) => setText(e.target.value)} required />
      <div className="source-actions">
        <button className="btn btn-primary btn-sm" disabled={busy || !fileName || !text.trim()}>
          {busy ? 'Ingesting…' : 'Ingest document'}
        </button>
        {msg && <span style={{ fontSize: 13.5, color: msg.bad ? 'var(--bad)' : 'var(--ok)' }}>{msg.text}</span>}
      </div>
      {report && <IngestReport report={report} />}
    </form>
  )
}

export default function KnowledgeBase({ onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [token, setToken] = useState(readToken)

  const apply = useCallback((r) => {
    if (r.ok) setData(r.data)
    else setError(r.data?.message ?? 'Could not load documents')
  }, [])
  const reload = useCallback(() => listDocuments().then(apply), [apply])

  useEffect(() => {
    listDocuments().then(apply)
  }, [apply])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function onDelete(doc) {
    const r = await deleteDocument(doc.docId, token)
    if (!r.ok) setError(r.data?.message ?? 'Could not remove document')
    else setError(null)
    reload()
    onChanged?.()
  }

  const canWrite = data?.uploadsEnabled && (!data.uploadsRequireToken || token)

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
          Answers come only from these documents. Each one is cleaned, split into sections and indexed for search.
        </p>
        {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}
        {data && (
          <>
            <p style={{ fontSize: 14 }}>
              {data.docs.length} document{data.docs.length === 1 ? '' : 's'} · {data.totalChunks} chunks
            </p>
            {data.docs.map((d) => (
              <DocCard key={d.docId} doc={d} canDelete={canWrite} onDelete={onDelete} />
            ))}

            {data.uploadsEnabled && data.uploadsRequireToken && (
              <div className="card doc form-grid">
                <div className="doc-title">Upload token</div>
                <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                  Changing the shared knowledge base requires the deployment's upload token.
                </p>
                <input
                  type="password"
                  placeholder="Upload token"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value)
                    saveToken(e.target.value)
                  }}
                  autoComplete="off"
                />
              </div>
            )}
            {canWrite && (
              <UploadForm
                token={token}
                onUploaded={() => {
                  reload()
                  onChanged?.()
                }}
              />
            )}
            {!data.uploadsEnabled && (
              <p className="muted" style={{ fontSize: 13.5 }}>
                Uploads are turned off on this deployment.
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
