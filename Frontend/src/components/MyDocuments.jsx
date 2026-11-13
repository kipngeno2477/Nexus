import { useRef, useState } from 'react'
import { addMyDocument, removeMyDocument } from '../api.js'
import IngestReport from './IngestReport.jsx'

const MAX_BYTES = 300_000

/**
 * Lets a citizen add their own plain-text documents (bylaw, notice, service charter).
 * Private to this browser session: not shared with other visitors, not stored on disk,
 * deleted after an hour of inactivity.
 */
export default function MyDocuments({ docs, limits, onAdded, onRemoved, disabled }) {
  const fileRef = useRef(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [openReport, setOpenReport] = useState(null)

  const maxDocs = limits?.maxDocs ?? 3
  const full = docs.length >= maxDocs

  async function send(fileName, text) {
    setBusy(true)
    setMsg(null)
    const r = await addMyDocument({ fileName, text })
    setBusy(false)
    if (!r.ok) return setMsg({ bad: true, text: r.data?.message ?? 'Could not add the document' })
    setMsg({ text: `Added “${r.data.doc.title}”: ${r.data.report.sections} section${r.data.report.sections === 1 ? '' : 's'} found.` })
    setOpenReport(r.data.doc.docId)
    onAdded(r.data.doc)
    return true
  }

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!f) return
    if (!/\.(txt|md)$/i.test(f.name)) return setMsg({ bad: true, text: 'Please choose a plain-text .txt or .md file.' })
    if (f.size > MAX_BYTES) return setMsg({ bad: true, text: `File is too large (max ${Math.round(MAX_BYTES / 1000)} KB).` })
    await send(f.name.replace(/[^\w .()-]/g, '_'), await f.text())
  }

  async function onPaste(e) {
    e.preventDefault()
    const name = (pasteName.trim() || 'my-document').replace(/[^\w .()-]/g, '_').replace(/\.(txt|md)$/i, '') + '.txt'
    if (await send(name, pasteText)) {
      setPasteText('')
      setPasteName('')
      setPasteOpen(false)
    }
  }

  async function remove(doc) {
    const r = await removeMyDocument(doc.docId)
    if (!r.ok && r.status !== 404) return setMsg({ bad: true, text: r.data?.message ?? 'Could not remove' })
    setMsg(null)
    onRemoved(doc)
  }

  return (
    <section className="mydocs" aria-label="Your documents">
      <div className="mydocs-head">
        <div>
          <strong>Your documents</strong>
          <span className="muted"> · ask about your own bylaw, notice or charter</span>
        </div>
        <div className="source-actions">
          <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={onFile} />
          <button type="button" className="btn btn-sm" disabled={busy || full || disabled} onClick={() => fileRef.current?.click()}>
            {busy ? 'Reading…' : '＋ Upload .txt'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy || full || disabled} onClick={() => setPasteOpen((o) => !o)}>
            {pasteOpen ? 'Cancel paste' : 'Paste text'}
          </button>
        </div>
      </div>

      {pasteOpen && (
        <form className="form-grid mydocs-paste" onSubmit={onPaste}>
          <input placeholder="Name (e.g. county-waste-bylaw)" value={pasteName} onChange={(e) => setPasteName(e.target.value)} maxLength={90} />
          <textarea placeholder="Paste the document text here. Messy formatting is fine." value={pasteText} onChange={(e) => setPasteText(e.target.value)} required />
          <div>
            <button className="btn btn-primary btn-sm" disabled={busy || !pasteText.trim()}>
              {busy ? 'Reading…' : 'Add document'}
            </button>
          </div>
        </form>
      )}

      {docs.length > 0 && (
        <ul className="mydocs-list">
          {docs.map((d) => (
            <li key={d.docId}>
              <div className="mydocs-row">
                <span className="mydocs-title" title={d.file}>📄 {d.title}</span>
                <span className="muted mono" style={{ fontSize: 12 }}>
                  {d.ingest?.sections ?? '?'} sections · {d.chunks} chunks
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenReport((o) => (o === d.docId ? null : d.docId))}>
                  {openReport === d.docId ? 'Hide report' : 'Report'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${d.title}`} onClick={() => remove(d)}>
                  ✕
                </button>
              </div>
              {openReport === d.docId && <IngestReport report={d.ingest} />}
            </li>
          ))}
        </ul>
      )}

      {msg && <p className="mydocs-msg" style={{ color: msg.bad ? 'var(--bad)' : 'var(--ok)' }}>{msg.text}</p>}
      <p className="muted mydocs-note">
        🔒 Only you can see these. They are not shared or saved to disk, and are deleted after {limits?.ttlMinutes ?? 60} minutes of
        inactivity. Up to {maxDocs} plain-text files.
      </p>
    </section>
  )
}
