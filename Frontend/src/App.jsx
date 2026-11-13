import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ask, health } from './api.js'
import StatusBanner from './components/StatusBanner.jsx'
import Answer from './components/Answer.jsx'
import Sources from './components/Sources.jsx'
import RetrievalDetails from './components/RetrievalDetails.jsx'
import PassageModal from './components/PassageModal.jsx'
import KnowledgeBase from './components/KnowledgeBase.jsx'

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
  const abortRef = useRef(null)
  const elapsed = useElapsed(loading)

  const refreshHealth = useCallback(() => health().then(setH), [])
  useEffect(() => {
    refreshHealth()
  }, [refreshHealth])

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
    const r = await ask({ question: text, k: Number(k), simulate: sim || undefined }, ac.signal)
    if (ac.signal.aborted) return
    setLoading(false)
    setResult(r.data && 'status' in r.data ? r.data : { status: 'network_error', message: r.data?.message ?? 'Unexpected response' })
    if (r.data?.status === 'model_unavailable' || r.data?.status === 'retrieval_error') refreshHealth()
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

  const citedRefs = useMemo(() => new Set(result?.citations?.map((c) => c.ref) ?? []), [result])
  const hasPipelineResult = result && Array.isArray(result.evidence)
  const showSourcesOnly = result?.status === 'model_unavailable' || citedRefs.size === 0
  const demoFailures = h?.data?.demoFailures

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
        <h2>Ask about your right to information</h2>
        <p>
          Answers come only from the Access to Information Act, 2016 (Kenya). Every statement links to the section it came
          from. If the Act doesn't cover your question, Nexus says so instead of guessing.
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
      {kbOpen && <KnowledgeBase onClose={closeKb} onChanged={refreshHealth} />}
    </div>
  )
}
