function Cites({ refs, activeRef, onCite }) {
  return refs.map((n) => (
    <button
      key={n}
      type="button"
      className={`cite ${activeRef === n ? 'active' : ''}`}
      onClick={() => onCite(n)}
      aria-label={`Show source ${n}`}
    >
      {n}
    </button>
  ))
}

const WARNING_TEXT = {
  invented_citation_removed: 'A citation the model produced did not match any retrieved passage and was removed.',
  low_overlap: 'A statement is worded quite differently from its cited passage. Check the excerpt.',
  no_supported_claims: 'The model replied, but none of its statements had valid supporting evidence.',
  partial_answer: 'The documents only partly answer this question.',
  fewer_than_k: null,
  retrieval_gate: null,
  claims_truncated: null,
  conflict_without_evidence: 'The model reported a conflict without citing passages, so it was ignored.',
}

export default function Answer({ result, activeRef, onCite }) {
  const { answer, conflicts, missing, unsupported, warnings, status, question } = result
  const hasClaims = answer.length > 0

  return (
    <div className="card answer">
      <p className="answer-q">“{question}”</p>

      {hasClaims ? (
        <ul className="claims">
          {answer.map((a, i) => (
            <li key={i}>
              {a.text}
              <Cites refs={a.refs} activeRef={activeRef} onCite={onCite} />
              {a.lowOverlap && <span className="low-overlap">check source</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {status === 'model_unavailable'
            ? 'No generated answer. The passages the search found are listed alongside so you can read the law directly.'
            : 'No answer was generated, so nothing is stated without evidence.'}
        </p>
      )}

      {conflicts.length > 0 && (
        <div className="sub">
          <h4>Conflicts between sources</h4>
          <ul>
            {conflicts.map((c, i) => (
              <li key={i}>
                {c.description}
                <Cites refs={c.refs} activeRef={activeRef} onCite={onCite} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {missing && hasClaims && (
        <div className="sub">
          <h4>Not covered by the documents</h4>
          <p>{missing}</p>
        </div>
      )}

      {unsupported.length > 0 && (
        <div className="sub">
          <h4>Removed: statements without valid evidence ({unsupported.length})</h4>
          <ul>
            {unsupported.map((u, i) => (
              <li key={i}>
                <s>{u.text}</s> <span className="muted">({u.reason})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="sub">
          <h4>Checks</h4>
          <ul className="warn-list">
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="warn-code">{w.code}</span>
                {WARNING_TEXT[w.code] ?? w.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
