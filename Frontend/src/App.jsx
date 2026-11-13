import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ask, health, listDocuments, listMyDocuments, setSessionId } from './api.js'
import StatusBanner from './components/StatusBanner.jsx'
import Answer from './components/Answer.jsx'
import Sources from './components/Sources.jsx'
import RetrievalDetails from './components/RetrievalDetails.jsx'
import PassageModal from './components/PassageModal.jsx'
import KnowledgeBase from './components/KnowledgeBase.jsx'
import MyDocuments from './components/MyDocuments.jsx'

const MAX_CHARS = 500
const EXAMPLES = [
  'How much does it cost to request information?',
  'How long does a public body have to respond to my request?',
  'Who can I complain to if my request is refused?',
  'Am I protected if I disclose information about corruption?',
  'What information can be withheld?',
  'When are county elections held?',
]

function useElapsed(running) {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!running) return
    const t0 = Date.now()
    const id = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => {
      clearInterval(id)
      setS(0)
    }
  }, [running])
  return s
}

function HealthPill({ h }) {
  if (!h) return <span className="pill"><span className="dot" /> checking…</span>
  if (!h.ok && h.status === 0) return <span className="pill"><span className="dot bad" /> server offline</span>
  const d = h.data
  const kbOk = d?.knowledgeBase?.ok && d.knowledgeBase.chunks > 0
  const modelOk = d?.model?.ok
  return (
    <span className="pill" title={d?.model?.error ?? ''}>
      <span className={`dot ${kbOk ? 'ok' : 'bad'}`} /> {d?.knowledgeBase?.chunks ?? 0} chunks
      <span className={`dot ${modelOk ? 'ok' : 'bad'}`} style={{ marginLeft: 6 }} /> {modelOk ? d.model.model : 'model offline'}
    </span>
  )
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [k, setK] = useState(4)
  const [simulate, setSimulate] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [activeRef, setActiveRef] = useState(null)
  const [showAllSources, setShowAllSources] = useState(false)
  const [passage, setPassage] = useState(null)
  const [kbOpen, setKbOpen] = useState(false)
  const [h, setH] = useState(null)
  const [docs, setDocs] = useState([])
  const [myDocs, setMyDocs] = useState([]) // private, this browser session only
  const [mySession, setMySession] = useState({ enabled: true, limits: null })
  const [docFilter, setDocFilter] = useState('') // '' = all documents
  const abortRef = useRef(null)
  const elapsed = useElapsed(loading)

  const refreshHealth = useCallback(() => health().then(setH), [])
  const refreshDocs = useCallback(
    () =>
      listDocuments().then((r) => {
        if (!r.ok) return
        setDocs(r.data.docs)
        setDocFilter((f) => (f && !f.startsWith('my-') && !r.data.docs.some((d) => d.docId === f) ? '' : f)) // removed doc → all
      }),
    []
  )
  const refreshMyDocs = useCallback(
    () =>
      listMyDocuments().then((r) => {
        if (!r.ok) return
        setMySession({ enabled: r.data.enabled, limits: r.data.limits })
        setMyDocs(r.data.docs)
        if (!r.data.active) setSessionId(null) // expired or never created
        setDocFilter((f) => (f.startsWith('my-') && !r.data.docs.some((d) => d.docId === f) ? '' : f))
      }),
    []
  )
  useEffect(() => {
    refreshHealth()
    refreshDocs()
    refreshMyDocs()
  }, [refreshHealth, refreshDocs, refreshMyDocs])

  // Deep link: /?q=question[&simulate=model] asks immediately (shareable questions, demo setup).
  const submitRef = useRef(null)
  useEffect(() => {
    submitRef.current = submit
  })
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const q = p.get('q')
    if (!q) return
    const id = setTimeout(() => submitRef.current(q.slice(0, MAX_CHARS), p.get('simulate') ?? ''), 0)
    return () => clearTimeout(id)
  }, [])

  async function submit(q = question, sim = simulate) {
    const text = q.trim()
    if (!text || loading) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setQuestion(text)
    setLoading(true)
    setResult(null)
    setActiveRef(null)
    setShowAllSources(false)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('q', text)
      window.history.replaceState(null, '', url)
    } catch {
      /* deep link is a convenience only */
    }
    const r = await ask({ question: text, k: Number(k), simulate: sim || undefined, docIds: docFilter ? [docFilter] : undefined }, ac.signal)
    if (ac.signal.aborted) return
    setLoading(false)
    setResult(r.data && 'status' in r.data ? r.data : { status: 'network_error', message: r.data?.message ?? 'Unexpected response' })
    if (r.data?.status === 'model_unavailable' || r.data?.status === 'retrieval_error') refreshHealth()
    if (r.data?.status === 'invalid_input' && /Unknown document/.test(r.data.message ?? '')) refreshMyDocs() // private session expired
  }

  function cancel() {
    abortRef.current?.abort()
    setLoading(false)
  }

  const onCite = useCallback((n) => {
    setActiveRef(n)
    document.getElementById(`source-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])
  const closePassage = useCallback(() => setPassage(null), [])
  const closeKb = useCallback(() => setKbOpen(false), [])
  const onKbChanged = useCallback(() => {
    refreshHealth()
    refreshDocs()
  }, [refreshHealth, refreshDocs])

  const citedRefs = useMemo(() => new Set(result?.citations?.map((c) => c.ref) ?? []), [result])
  const hasPipelineResult = result && Array.isArray(result.evidence)
  const showSourcesOnly = result?.status === 'model_unavailable' || citedRefs.size === 0
  const demoFailures = h?.data?.demoFailures
  const allDocs = [...docs, ...myDocs]
  const filteredDoc = allDocs.find((d) => d.docId === docFilter)
  const sharedText = docs.length === 1 ? docs[0].title : docs.length > 1 ? `the ${docs.length} documents in the knowledge base` : 'the documents in the knowledge base'
  const scopeText = filteredDoc
    ? `“${filteredDoc.title}”${filteredDoc.private ? ' (your document)' : ''}`
    : myDocs.length
      ? `${sharedText} and your ${myDocs.length === 1 ? 'document' : `${myDocs.length} documents`}`
      : sharedText

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">N</div>
          <div>
            <h1>Nexus</h1>
            <p>Plain-language answers from public law, cited to the section</p>
          </div>
        </div>
        <div className="header-actions">
          <HealthPill h={h} />
          <button type="button" className="btn btn-sm" onClick={() => setKbOpen(true)}>
            Knowledge base
          </button>
        </div>
      </header>

      <section className="hero">
        <h2>Ask about the law in plain language</h2>
        <p>
          Answers come only from {scopeText}. Every statement links to the section it came from. If the documents don't
          cover your question, Nexus says so instead of guessing.
        </p>

        <form
          className="card ask"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor="q" className="sr-only">Your question</label>
          <textarea
            id="q"
            value={question}
            maxLength={MAX_CHARS + 50}
            placeholder="e.g. How long does a government office have to reply to my information request?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="ask-row">
            <div className="ask-controls">
              {allDocs.length > 1 && (
                <label title="Limit the search to one document">
                  Search in
                  <select value={docFilter} onChange={(e) => setDocFilter(e.target.value)} style={{ maxWidth: 220 }}>
                    <option value="">All documents</option>
                    {docs.map((d) => (
                      <option key={d.docId} value={d.docId}>
                        {d.title}
                      </option>
                    ))}
                    {myDocs.length > 0 && (
                      <optgroup label="Your documents">
                        {myDocs.map((d) => (
                          <option key={d.docId} value={d.docId}>
                            {d.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              )}
              <label title="How many passages the bounded heap selects as evidence">
                Passages (K)
                <input type="number" min={1} max={10} step={1} value={k} onChange={(e) => setK(e.target.value)} />
              </label>
              {demoFailures && (
                <label title="Demo only: simulate an outage to show failure handling">
                  Simulate
                  <select value={simulate} onChange={(e) => setSimulate(e.target.value)}>
                    <option value="">nothing</option>
                    <option value="model">model outage</option>
                    <option value="retrieval">search outage</option>
                  </select>
                </label>
              )}
              <span className={`counter ${question.length > MAX_CHARS ? 'over' : ''}`}>
                {question.length}/{MAX_CHARS}
              </span>
            </div>
            {loading ? (
              <button type="button" className="btn" onClick={cancel}>Cancel</button>
            ) : (
              <button className="btn btn-primary" disabled={!question.trim()}>Ask</button>
            )}
          </div>
        </form>

        {mySession.enabled && (
          <MyDocuments
            docs={myDocs}
            limits={mySession.limits}
            disabled={loading}
            onAdded={(doc) => {
              setMyDocs((d) => [...d, doc])
              setDocFilter(doc.docId) // search the new document by default
            }}
            onRemoved={(doc) => {
              setMyDocs((d) => d.filter((x) => x.docId !== doc.docId))
              setDocFilter((f) => (f === doc.docId ? '' : f))
            }}
          />
        )}

        <div className="examples">
          <span className="chip-label">Try:</span>
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="chip" disabled={loading} onClick={() => submit(q)}>
              {q}
            </button>
          ))}
        </div>
      </section>

      {loading && (
        <div className="card loading" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <div>
            <p>{elapsed < 2 ? 'Searching the Act…' : 'Reading the selected passages and writing a cited answer…'}</p>
            <small>
              {elapsed}s{elapsed > 15 && ' · a local model on CPU can take up to a minute'}
            </small>
          </div>
        </div>
      )}

      {result && !loading && (
        <>
          <div className="result">
            <div>
              <StatusBanner status={result.status} message={result.status === 'answered' ? null : result.message} />
              {hasPipelineResult && result.status !== 'invalid_input' && (
                <Answer result={result} activeRef={activeRef} onCite={onCite} />
              )}
            </div>
            {hasPipelineResult && result.evidence.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="section-title">
                    {showSourcesOnly || showAllSources ? `Retrieved passages (${result.evidence.length})` : `Sources (${citedRefs.size})`}
                  </h3>
                  {!showSourcesOnly && result.evidence.length > citedRefs.size && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAllSources((s) => !s)}>
                      {showAllSources ? 'Cited only' : `All ${result.evidence.length} retrieved`}
                    </button>
                  )}
                </div>
                <Sources
                  evidence={result.evidence}
                  citedRefs={citedRefs}
                  activeRef={activeRef}
                  onOpen={setPassage}
                  showAll={showSourcesOnly || showAllSources}
                />
              </div>
            )}
          </div>
          {hasPipelineResult && result.debug && <RetrievalDetails result={result} />}
        </>
      )}

      <footer className="footer">
        Nexus provides information from public documents and is not legal advice. Retrieval: BM25 keyword scoring with
        bounded min-heap top-K selection. Workflow: retrieve → synthesize → cite → done.
      </footer>

      {passage && <PassageModal source={passage} onClose={closePassage} />}
      {kbOpen && <KnowledgeBase onClose={closeKb} onChanged={onKbChanged} />}
    </div>
  )
}
