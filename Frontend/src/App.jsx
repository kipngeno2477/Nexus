import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ask, health, listDocuments, listMyDocuments, setSessionId } from './api.js'
import Sidebar from './components/Sidebar.jsx'
import TopNav from './components/TopNav.jsx'
import HeroSection from './components/HeroSection.jsx'
import ActiveChatCard from './components/ActiveChatCard.jsx'
import PromptInput from './components/PromptInput.jsx'
import TryAsking from './components/TryAsking.jsx'
import PassageModal from './components/PassageModal.jsx'
import KnowledgeBase from './components/KnowledgeBase.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import AboutModal from './components/AboutModal.jsx'
import HistoryModal from './components/HistoryModal.jsx'
import UploadModal from './components/UploadModal.jsx'
import ScopeSelector from './components/ScopeSelector.jsx'

const MAX_CHARS = 500

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

export default function App() {
  const [question, setQuestion] = useState('')
  const [activeQuestion, setActiveQuestion] = useState('')
  const [k, setK] = useState(4)
  const [simulate, setSimulate] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [activeRef, setActiveRef] = useState(null)
  const [showAllSources, setShowAllSources] = useState(false)
  const [passage, setPassage] = useState(null)

  // Modals & Panels
  const [kbOpen, setKbOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  // Telemetry & Documents
  const [h, setH] = useState(null)
  const [docs, setDocs] = useState([])
  const [myDocs, setMyDocs] = useState([])
  const [mySession, setMySession] = useState({ enabled: true, limits: null })
  const [docFilter, setDocFilter] = useState('')
  const [history, setHistory] = useState([
    {
      question: 'Am I protected if I disclose information about corruption?',
      timestamp: 'Today, 10:45 AM',
    },
    {
      question: 'How long does a public body have to respond to my request?',
      timestamp: 'Today, 10:30 AM',
    },
  ])

  const abortRef = useRef(null)
  const resultsRef = useRef(null)
  const dockSentinelRef = useRef(null)
  const [dockStuck, setDockStuck] = useState(false)

  // The question box sticks to the top of the scroll area; show its backdrop only while stuck.
  useEffect(() => {
    const el = dockSentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    // The huge bottom margin makes "below the screen" count as visible, so "not visible" means only
    // "scrolled past the top", even when jumping straight from far below to far above.
    const io = new IntersectionObserver(([e]) => setDockStuck(!e.isIntersecting), { rootMargin: '0px 0px 100000px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // When a question is sent (progress) and when its answer arrives, bring the response into view.
  // The question box itself never moves: results render below it.
  useEffect(() => {
    if (!loading && !result) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const id = requestAnimationFrame(() =>
      resultsRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    )
    return () => cancelAnimationFrame(id)
  }, [loading, result])
  const elapsed = useElapsed(loading)

  const refreshHealth = useCallback(() => health().then(setH), [])
  const refreshDocs = useCallback(
    () =>
      listDocuments().then((r) => {
        if (!r.ok || !r.data || !Array.isArray(r.data.docs)) return
        setDocs(r.data.docs)
        setDocFilter((f) => (f && !f.startsWith('my-') && !r.data.docs.some((d) => d.docId === f) ? '' : f))
      }),
    []
  )
  const refreshMyDocs = useCallback(
    () =>
      listMyDocuments().then((r) => {
        if (!r.ok || !r.data || !Array.isArray(r.data.docs)) return
        setMySession({ enabled: r.data.enabled ?? true, limits: r.data.limits ?? null })
        setMyDocs(r.data.docs)
        if (!r.data.active) setSessionId(null)
        setDocFilter((f) => (f.startsWith('my-') && !r.data.docs.some((d) => d.docId === f) ? '' : f))
      }),
    []
  )

  useEffect(() => {
    refreshHealth()
    refreshDocs()
    refreshMyDocs()
  }, [refreshHealth, refreshDocs, refreshMyDocs])

  // Deep link support
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

  // scope: '' = all documents, otherwise one docId. Defaults to the visible "Search in" choice.
  async function submit(q = question, sim = simulate, scope = docFilter) {
    const text = q.trim()
    if (!text || loading) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setQuestion('')
    setActiveQuestion(text)
    setLoading(true)
    setResult(null)
    setActiveRef(null)
    setShowAllSources(false)

    // Save to inquiry history
    setHistory((prev) => [
      {
        question: text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
      ...prev.filter((item) => item.question !== text),
    ])

    try {
      const url = new URL(window.location.href)
      url.searchParams.set('q', text)
      window.history.replaceState(null, '', url)
    } catch {
      /* deep link convenience */
    }

    const r = await ask(
      {
        question: text,
        k: Number(k),
        simulate: sim || undefined,
        docIds: scope ? [scope] : undefined,
      },
      ac.signal
    )

    if (ac.signal.aborted) return
    setLoading(false)
    setResult(
      r.data && 'status' in r.data
        ? { ...r.data, scope: scope || null } // remember which documents this answer searched
        : { status: 'network_error', message: r.data?.message ?? 'Unexpected response' }
    )
    if (r.data?.status === 'model_unavailable' || r.data?.status === 'retrieval_error') refreshHealth()
    if (r.data?.status === 'invalid_input' && /Unknown document/.test(r.data.message ?? '')) refreshMyDocs()
  }

  function handleCancel() {
    abortRef.current?.abort()
    setLoading(false)
  }

  function handleNewChat() {
    handleCancel()
    setQuestion('')
    setActiveQuestion('')
    setResult(null)
    setActiveRef(null)
    setShowAllSources(false)
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
  const safeDocs = Array.isArray(docs) ? docs : []
  const safeMyDocs = Array.isArray(myDocs) ? myDocs : []
  const allDocs = [...safeDocs, ...safeMyDocs]
  const filteredDoc = allDocs.find((d) => d.docId === docFilter)
  const sharedText =
    safeDocs.length === 1
      ? safeDocs[0].title
      : safeDocs.length > 1
      ? `the ${safeDocs.length} documents in the knowledge base`
      : 'the documents in the knowledge base'
  const scopeText = filteredDoc
    ? `“${filteredDoc.title}”${filteredDoc.private ? ' (your document)' : ''}`
    : safeMyDocs.length
    ? `${sharedText} and your ${safeMyDocs.length === 1 ? 'document' : `${safeMyDocs.length} documents`}`
    : sharedText

  return (
    <div className="nexus-layout">
      {/* Left Sidebar */}
      <Sidebar
        onNewChat={handleNewChat}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenKb={() => setKbOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        online={h?.status !== 0}
      />

      {/* Main Canvas */}
      <main className="nexus-main">
        {/* Top Navbar */}
        <TopNav
          onOpenKb={() => setKbOpen(true)}
          chunksCount={h?.data?.knowledgeBase?.chunks}
          modelName={h?.data?.model?.model}
        />

        {/* Hero Section */}
        <HeroSection scopeText={scopeText} />

        {/* Question box: stays where it is; sticks to the top while scrolling through long answers */}
        <div ref={dockSentinelRef} className="prompt-dock-sentinel" aria-hidden="true" />
        <div className={`prompt-dock ${dockStuck ? 'is-stuck' : ''}`}>
          {/* Which documents the next question searches (visible, one click to change) */}
          <ScopeSelector docs={safeDocs} myDocs={safeMyDocs} value={docFilter} onChange={setDocFilter} disabled={loading} />

          {/* Prompt Input Bar */}
          <PromptInput
            question={question}
            setQuestion={setQuestion}
            onSubmit={() => submit(question)}
            onCancel={handleCancel}
            loading={loading}
            onOpenUpload={() => setUploadOpen(true)}
            hasPrivateDocs={myDocs.length > 0}
            maxChars={MAX_CHARS}
          />
        </div>

        {/* Try Asking Suggestions */}
        <TryAsking
          onSelect={(query) => {
            setQuestion(query)
            submit(query)
          }}
          disabled={loading}
        />

        {/* Results render below the question box, so a growing answer never pushes the box down */}
        <div ref={resultsRef} className="results-anchor">
          {/* Active Chat / Results Container */}
          <ActiveChatCard
            activeQuestion={activeQuestion}
            loading={loading}
            elapsed={elapsed}
            result={result}
            hasPipelineResult={hasPipelineResult}
            citedRefs={citedRefs}
            activeRef={activeRef}
            onCite={onCite}
            setPassage={setPassage}
            showAllSources={showAllSources}
            setShowAllSources={setShowAllSources}
            showSourcesOnly={showSourcesOnly}
            scopeTitle={result?.scope ? allDocs.find((d) => d.docId === result.scope)?.title ?? result.scope : null}
            onSearchAll={() => {
              setDocFilter('')
              submit(activeQuestion, simulate, '')
            }}
          />
        </div>
      </main>

      {/* Modals and Drawers */}
      {passage && <PassageModal source={passage} onClose={closePassage} />}
      {kbOpen && <KnowledgeBase onClose={closeKb} onChanged={onKbChanged} />}
      {settingsOpen && (
        <SettingsModal
          k={k}
          setK={setK}
          simulate={simulate}
          setSimulate={setSimulate}
          demoFailures={demoFailures}
          docFilter={docFilter}
          setDocFilter={setDocFilter}
          docs={docs}
          myDocs={myDocs}
          h={h}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {historyOpen && (
        <HistoryModal
          history={history}
          onSelectQuery={(q) => {
            setQuestion(q)
            submit(q)
          }}
          onClearHistory={() => setHistory([])}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {uploadOpen && (
        <UploadModal
          myDocs={myDocs}
          setMyDocs={setMyDocs}
          setDocFilter={setDocFilter}
          limits={mySession.limits}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </div>
  )
}
