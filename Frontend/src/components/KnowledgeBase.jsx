import React, { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  FileText,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  X,
  Layers,
  Upload,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Key,
} from 'lucide-react'
import { listDocuments, listChunks, uploadDocument, deleteDocument } from '../api.js'
import IngestReport from './IngestReport.jsx'
import { readDocumentFile, ACCEPT, DocumentFileError } from '../documentFile.js'

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
    /* storage unavailable */
  }
}

function DocCard({ doc, canDelete, onDelete }) {
  const [chunks, setChunks] = useState(null)
  const [open, setOpen] = useState(null) // 'sections' | 'report' | null
  const [chunkFilter, setChunkFilter] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [loadingChunks, setLoadingChunks] = useState(false)

  async function toggleSections() {
    if (open === 'sections') {
      setOpen(null)
      return
    }
    setOpen('sections')
    if (!chunks) {
      setLoadingChunks(true)
      const r = await listChunks(doc.docId)
      setLoadingChunks(false)
      setChunks(r.ok ? r.data.chunks : [])
    }
  }

  const filteredChunks = chunks?.filter(
    (c) =>
      c.sectionTitle.toLowerCase().includes(chunkFilter.toLowerCase()) ||
      c.chunkId.toLowerCase().includes(chunkFilter.toLowerCase())
  )

  return (
    <div className="kb-doc-card">
      {/* Document Header */}
      <div className="kb-doc-header">
        <div className="kb-doc-icon-wrap">
          <FileText size={22} className="text-cyan-400" />
        </div>
        <div className="kb-doc-details">
          <div className="kb-doc-title-row">
            <h4 className="kb-doc-title">{doc.title}</h4>
            {doc.uploaded && <span className="kb-badge-uploaded">Uploaded</span>}
          </div>
          <div className="kb-doc-meta">
            <span className="mono text-cyan-300">{doc.docId}</span>
            <span className="meta-sep">•</span>
            <span>{doc.file}</span>
            <span className="meta-sep">•</span>
            <span className="kb-chunks-badge">{doc.chunks} Statutory Chunks</span>
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="kb-doc-actions">
        <button
          type="button"
          className={`btn-kb-action ${open === 'sections' ? 'active' : ''}`}
          onClick={toggleSections}
        >
          <Layers size={14} />
          <span>{open === 'sections' ? 'Hide Sections' : `Browse Sections (${doc.chunks})`}</span>
          {open === 'sections' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {doc.ingest && (
          <button
            type="button"
            className={`btn-kb-action ${open === 'report' ? 'active' : ''}`}
            onClick={() => setOpen((o) => (o === 'report' ? null : 'report'))}
          >
            <ShieldCheck size={14} />
            <span>{open === 'report' ? 'Hide Ingestion Stats' : 'Ingestion Quality'}</span>
          </button>
        )}

        {doc.sourceUrl && (
          <a
            className="btn-kb-action"
            href={doc.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title="Open official statutory gazette source"
          >
            <ExternalLink size={14} />
            <span>Official Statute ↗</span>
          </a>
        )}

        {canDelete && doc.uploaded && !confirming && (
          <button
            type="button"
            className="btn-kb-action text-red-400"
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={14} />
            <span>Remove</span>
          </button>
        )}

        {confirming && (
          <div className="kb-confirm-remove">
            <span>Confirm removal?</span>
            <button
              type="button"
              className="btn-kb-action confirm-yes"
              onClick={() => onDelete(doc)}
            >
              Yes, delete
            </button>
            <button
              type="button"
              className="btn-kb-action confirm-no"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Ingestion Report Dropdown */}
      {open === 'report' && (
        <div className="kb-report-container">
          <IngestReport report={doc.ingest} />
        </div>
      )}

      {/* Interactive Chunks & Sections Inspector */}
      {open === 'sections' && (
        <div className="kb-sections-container">
          <div className="kb-sections-search-bar">
            <Search size={14} className="text-gray-400" />
            <input
              type="text"
              placeholder="Filter sections (e.g. fees, review, exemptions, 12, 14)…"
              value={chunkFilter}
              onChange={(e) => setChunkFilter(e.target.value)}
              className="kb-sections-search-input"
            />
            {filteredChunks && (
              <span className="kb-sections-count">
                {filteredChunks.length} of {chunks.length} sections
              </span>
            )}
          </div>

          {loadingChunks ? (
            <p className="kb-muted-text">Loading statutory chunk index…</p>
          ) : (
            <div className="kb-chunks-grid">
              {filteredChunks?.map((c) => (
                <div key={c.chunkId} className="kb-chunk-card">
                  <div className="kb-chunk-top">
                    <span className="kb-chunk-id">{c.chunkId}</span>
                    <span className="kb-chunk-words">{c.words} words</span>
                  </div>
                  <h5 className="kb-chunk-title">{c.sectionTitle}</h5>
                  {c.part && <span className="kb-chunk-part">{c.part}</span>}
                </div>
              ))}
              {filteredChunks?.length === 0 && (
                <p className="kb-muted-text">No sections match your filter.</p>
              )}
            </div>
          )}
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
  const [origin, setOrigin] = useState({}) // { sourceFormat, originalName, pages } of the picked file

  async function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setMsg(null)
    setReport(null)
    setBusy(true)
    try {
      // PDFs are converted in the browser; the extracted text appears below for review before ingesting.
      const { fileName: name, text: body, title: pdfTitle, ...meta } = await readDocumentFile(f, {
        maxTextChars: 900_000,
        onProgress: ({ page, pages }) => setMsg({ bad: false, text: `Reading PDF… page ${page} of ${pages}` }),
      })
      setFileName(name)
      setText(body)
      setOrigin(meta)
      if (pdfTitle) setTitle((t) => t || pdfTitle)
      setMsg(meta.sourceFormat === 'pdf' ? { bad: false, text: `Extracted text from ${meta.pages} PDF pages. Review it below, then ingest.` } : null)
    } catch (err) {
      if (!(err instanceof DocumentFileError)) console.error('readDocumentFile failed:', err)
      setMsg({ bad: true, text: err instanceof DocumentFileError ? err.message : 'Could not read this file.' })
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    setReport(null)
    const r = await uploadDocument({ fileName, title: title.trim() || undefined, text, ...origin }, token)
    setBusy(false)
    if (r.ok) {
      setMsg({ bad: false, text: `Successfully indexed “${r.data.doc.title}”. Ready for retrieval.` })
      setReport(r.data.report)
      setFileName('')
      setTitle('')
      setText('')
      setOrigin({})
      onUploaded()
    } else {
      setMsg({ bad: true, text: r.data?.message ?? 'Upload failed' })
    }
  }

  return (
    <form className="kb-upload-container" onSubmit={submit}>
      <div className="kb-upload-header">
        <Upload size={17} className="text-cyan-400" />
        <h4 className="kb-upload-title">Ingest Additional Statutory Document</h4>
      </div>
      <p className="kb-muted-text">
        Upload a PDF (with selectable text, up to 15 MB) or plain text (.txt or .md, up to ~900 KB).
        PDFs are converted to text in your browser. The pipeline automatically strips running
        headers, repairs broken line breaks, and splits sections into bounded chunks.
      </p>

      <div className="kb-upload-fields">
        <input
          type="file"
          accept={ACCEPT}
          onChange={onFile}
          disabled={busy}
          className="kb-file-input"
        />
        <div className="kb-input-grid">
          <input
            placeholder="File name (e.g. county-licensing-act.txt)"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            required
            className="kb-text-input"
          />
          <input
            placeholder="Official Title (optional; extracted from text if empty)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            className="kb-text-input"
          />
        </div>
        <textarea
          placeholder="…or paste legal document text directly here"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="kb-textarea-input"
          required
        />
      </div>

      <div className="kb-upload-actions">
        <button
          type="submit"
          className="btn-primary-modal"
          disabled={busy || !fileName || !text.trim()}
        >
          {busy ? 'Ingesting & Indexing…' : 'Ingest to Knowledge Base'}
        </button>
        {msg && (
          <span className={`kb-msg-badge ${msg.bad ? 'bad' : 'ok'}`}>
            {msg.bad ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
            {msg.text}
          </span>
        )}
      </div>

      {report && (
        <div className="kb-report-container">
          <IngestReport report={report} />
        </div>
      )}
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
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box kb-modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="kb-header-icon-squircle">
              <BookOpen size={18} className="text-cyan-400" />
            </div>
            <div>
              <h3 className="modal-title">Statutory Knowledge Base</h3>
              <p className="kb-header-sub">
                Official Kenya legislation indexed for verifiable citations & zero-hallucination legal Q&A
              </p>
            </div>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body kb-modal-body">
          {/* Telemetry KPI Strip */}
          <div className="kb-telemetry-strip">
            <div className="kb-telemetry-item">
              <span className="kb-telemetry-label">Active Documents</span>
              <strong className="kb-telemetry-val text-cyan-300">
                {data ? `${data.docs.length} Act` : '1 Act'}
              </strong>
            </div>
            <div className="kb-telemetry-item">
              <span className="kb-telemetry-label">Indexed Chunks</span>
              <strong className="kb-telemetry-val text-emerald-400">
                {data ? `${data.totalChunks} Chunks` : '53 Chunks'}
              </strong>
            </div>
            <div className="kb-telemetry-item">
              <span className="kb-telemetry-label">Retrieval Engine</span>
              <strong className="kb-telemetry-val">BM25 + Bounded Min-Heap</strong>
            </div>
            <div className="kb-telemetry-item">
              <span className="kb-telemetry-label">Statutory Grounding</span>
              <strong className="kb-telemetry-val text-purple-300">Laws of Kenya</strong>
            </div>
          </div>

          {error && (
            <div className="status-msg-banner bad">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* List of Documents */}
          <div className="kb-docs-list">
            {data?.docs.map((d) => (
              <DocCard key={d.docId} doc={d} canDelete={canWrite} onDelete={onDelete} />
            ))}
          </div>

          {/* Upload Token Box (If required) */}
          {data?.uploadsEnabled && data.uploadsRequireToken && (
            <div className="kb-token-box">
              <div className="kb-token-header">
                <Key size={15} className="text-amber-400" />
                <span className="kb-token-title">Knowledge Base Admin Token</span>
              </div>
              <input
                type="password"
                placeholder="Enter deployment upload token to add or modify shared documents…"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  saveToken(e.target.value)
                }}
                className="select-input"
                autoComplete="off"
              />
            </div>
          )}

          {/* Ingest Form */}
          {canWrite && (
            <UploadForm
              token={token}
              onUploaded={() => {
                reload()
                onChanged?.()
              }}
            />
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button type="button" className="btn-primary-modal" onClick={onClose}>
            Close Knowledge Base
          </button>
        </div>
      </div>
    </div>
  )
}
