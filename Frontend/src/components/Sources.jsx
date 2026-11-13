export default function Sources({ evidence, citedRefs, activeRef, onOpen, showAll }) {
  const list = showAll ? evidence : evidence.filter((e) => citedRefs.has(e.ref))
  const hasCitations = citedRefs.size > 0 // with no answer, "not cited" is meaningless

  if (list.length === 0) {
    return <p className="muted">No passages were retrieved for this question.</p>
  }

  return (
    <div className="sources">
      {list.map((e) => (
        <article
          key={e.ref}
          id={`source-${e.ref}`}
          className={`card source ${activeRef === e.ref ? 'active' : ''} ${hasCitations && !citedRefs.has(e.ref) ? 'uncited' : ''}`}
        >
          <div className="source-head">
            <span className="source-ref">{e.ref}</span>
            <div>
              <div className="source-title">{e.sectionTitle}</div>
              <div className="source-meta">
                {e.docTitle}
                {e.part ? ` · ${e.part}` : ''}
              </div>
            </div>
          </div>
          <p className="source-excerpt">{e.excerpt}</p>
          <div className="source-actions">
            <button type="button" className="btn btn-sm" onClick={() => onOpen(e)}>
              Read full passage
            </button>
            {e.sourceUrl && (
              <a className="btn btn-sm" href={e.sourceUrl} target="_blank" rel="noreferrer">
                Original ↗
              </a>
            )}
            <span className="tag">{e.chunkId}</span>
            {hasCitations && !citedRefs.has(e.ref) && <span className="tag">retrieved, not cited</span>}
            <span className="score">score {e.score.toFixed(2)}</span>
          </div>
        </article>
      ))}
    </div>
  )
}
