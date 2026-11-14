import React, { useRef, useState } from 'react'
import { X, Upload, FileText, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react'
import { addMyDocument, removeMyDocument } from '../api.js'
import { readDocumentFile, ACCEPT, DocumentFileError } from '../documentFile.js'

export default function UploadModal({
  myDocs,
  setMyDocs,
  setDocFilter,
  onClose,
  limits,
}) {
  const fileRef = useRef(null)
  const [activeTab, setActiveTab] = useState('upload') // 'upload' or 'paste'
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [progress, setProgress] = useState(null) // PDF reading: { page, pages }

  const maxDocs = limits?.maxDocs ?? 3
  const maxChars = limits?.maxChars ?? 300_000
  const full = myDocs.length >= maxDocs

  async function send(fileName, text, origin = {}) {
    setBusy(true)
    setMsg(null)
    const r = await addMyDocument({ fileName, text, ...origin })
    setBusy(false)
    if (!r.ok) {
      setMsg({ bad: true, text: r.data?.message ?? 'Could not add the document' })
      return false
    }
    const hf = origin.headerFooterLinesRemoved ? `, ${origin.headerFooterLinesRemoved} running header/footer lines removed` : ''
    const fromPdf = r.data.doc.sourceFormat === 'pdf' ? ` from a ${r.data.doc.pages}-page PDF${hf}` : ''
    setMsg({
      bad: false,
      text: `Added “${r.data.doc.title}”${fromPdf}: ${r.data.report.sections} sections, ${r.data.doc.chunks} chunks indexed.`,
    })
    setMyDocs((prev) => [...prev, r.data.doc])
    setDocFilter(r.data.doc.docId) // set search focus to this document
    return true
  }

  async function onFileSelect(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setMsg(null)
    setBusy(true)
    let file
    try {
      // PDFs are converted to text here in the browser; the PDF itself is never uploaded.
      file = await readDocumentFile(f, { maxTextChars: maxChars, onProgress: setProgress })
    } catch (err) {
      if (!(err instanceof DocumentFileError)) console.error('readDocumentFile failed:', err)
      setBusy(false)
      setProgress(null)
      return setMsg({ bad: true, text: err instanceof DocumentFileError ? err.message : 'Could not read this file.' })
    }
    setProgress(null)
    const { fileName, text, ...origin } = file
    await send(fileName, text, origin)
  }

  async function onPasteSubmit(e) {
    e.preventDefault()
    const name =
      (pasteName.trim() || 'county-bylaw').replace(/[^\w .()-]/g, '_').replace(/\.(txt|md)$/i, '') + '.txt'
    if (await send(name, pasteText)) {
      setPasteText('')
      setPasteName('')
    }
  }

  async function handleRemove(doc) {
    const r = await removeMyDocument(doc.docId)
    if (!r.ok && r.status !== 404) {
      return setMsg({ bad: true, text: r.data?.message ?? 'Could not remove document' })
    }
    setMyDocs((prev) => prev.filter((x) => x.docId !== doc.docId))
    setDocFilter((f) => (f === doc.docId ? '' : f))
    setMsg({ bad: false, text: `Removed “${doc.title}”.` })
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Upload size={18} className="text-cyan-400" />
            <h3 className="modal-title">Attach Private Document / County Bylaw</h3>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="upload-intro-text">
            Upload your own county bylaw, legal gazette notice, or municipal charter. PDFs are converted
            to text on your device; only the text is sent. Documents stay private in server memory for
            this browser session only.
          </p>

          {/* Tabs: Upload File vs Paste Text */}
          <div className="upload-tabs">
            <button
              type="button"
              className={`upload-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              Upload PDF / .txt / .md
            </button>
            <button
              type="button"
              className={`upload-tab-btn ${activeTab === 'paste' ? 'active' : ''}`}
              onClick={() => setActiveTab('paste')}
            >
              Paste Document Text
            </button>
          </div>

          {activeTab === 'upload' ? (
            <div
              className={`dropzone-box ${full ? 'disabled' : ''}`}
              onClick={() => !full && fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                hidden
                onChange={onFileSelect}
                disabled={full || busy}
              />
              <Upload size={32} className="dropzone-icon" />
              <p className="dropzone-primary-text">
                {full
                  ? `Document limit reached (max ${maxDocs})`
                  : progress
                    ? `Reading PDF… page ${progress.page} of ${progress.pages}`
                    : busy
                      ? 'Ingesting and indexing document…'
                      : 'Click to select a PDF, .txt or .md legal file'}
              </p>
              <span className="dropzone-sub-text">
                PDF up to 15 MB (with selectable text) or .txt/.md up to 900 KB • Max {Math.round(maxChars / 1000)}K characters of text • Stored in memory only
              </span>
            </div>
          ) : (
            <form onSubmit={onPasteSubmit} className="paste-form">
              <input
                type="text"
                placeholder="Document title (e.g. nairobi-county-waste-bylaw)"
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
                maxLength={90}
                className="select-input"
              />
              <textarea
                placeholder="Paste the document contents here. Section headings, clauses, and articles are automatically parsed."
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className="paste-textarea"
                required
              />
              <button
                type="submit"
                className="btn-primary-modal"
                disabled={busy || !pasteText.trim() || full}
              >
                {busy ? 'Ingesting…' : 'Index Document'}
              </button>
            </form>
          )}

          {msg && (
            <div className={`status-msg-banner ${msg.bad ? 'bad' : 'ok'}`}>
              {msg.bad ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
              <span>{msg.text}</span>
            </div>
          )}

          {/* List of currently uploaded documents */}
          {myDocs.length > 0 && (
            <div className="attached-docs-section">
              <h5 className="attached-heading">Your Active Session Documents ({myDocs.length})</h5>
              <div className="attached-list">
                {myDocs.map((doc) => (
                  <div key={doc.docId} className="attached-doc-row">
                    <div className="attached-doc-info">
                      <FileText size={16} className="text-cyan-400" />
                      <div>
                        <strong className="attached-doc-title">{doc.title}</strong>
                        <span className="attached-doc-meta">
                          {doc.sourceFormat === 'pdf' ? `PDF, ${doc.pages} pages • ` : ''}
                          {doc.ingest?.sections ?? '?'} sections • {doc.chunks} chunks
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-remove-doc"
                      onClick={() => handleRemove(doc)}
                      title="Remove this document"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-primary-modal" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
