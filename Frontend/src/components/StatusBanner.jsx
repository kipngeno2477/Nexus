const STATUS = {
  answered: { tone: 'ok', icon: '✓', title: 'Answered from the documents', body: 'Every statement below is cited to the source section it came from.' },
  insufficient_evidence: { tone: 'warn', icon: '!', title: 'Not enough evidence', body: null },
  conflicting_evidence: { tone: 'warn', icon: '⇄', title: 'The sources disagree', body: null },
  invalid_input: { tone: 'info', icon: 'i', title: 'Check your question', body: null },
  model_unavailable: { tone: 'bad', icon: '⚠', title: 'Answer generator unavailable', body: null },
  retrieval_error: { tone: 'bad', icon: '⚠', title: 'Search failed', body: null },
  step_budget_exceeded: { tone: 'bad', icon: '⚠', title: 'Workflow stopped', body: null },
  network_error: { tone: 'bad', icon: '⚠', title: 'Connection problem', body: null },
  rate_limited: { tone: 'info', icon: '⏳', title: 'Please slow down', body: null },
}

export default function StatusBanner({ status, message }) {
  const s = STATUS[status] ?? { tone: 'bad', icon: '⚠', title: 'Something went wrong', body: null }
  return (
    <div className={`banner ${s.tone}`} role={s.tone === 'bad' ? 'alert' : 'status'}>
      <span className="banner-icon" aria-hidden="true">{s.icon}</span>
      <div>
        <strong>{s.title}</strong>
        <p>{message || s.body}</p>
      </div>
    </div>
  )
}
