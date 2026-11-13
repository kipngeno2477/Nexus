function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat-v">{value}</div>
      <div className="stat-l">{label}</div>
    </div>
  )
}

export default function RetrievalDetails({ result }) {
  const { debug, evidence } = result
  const r = debug.retrieval
  const llm = debug.llm

  return (
    <details className="card details">
      <summary>How this answer was produced</summary>
      <div className="details-body">
        <div>
          <h4 className="section-title">Workflow (fixed steps, bounded)</h4>
          <div className="trace">
            {debug.trace.map((t, i) => (
              <span key={i} style={{ display: 'contents' }}>
                <span className="trace-step" title={`${t.ms} ms`}>
                  {t.state} <span className="muted">{t.ms < 1 ? '<1' : Math.round(t.ms)}ms</span>
                </span>
                <span className="trace-arrow">→</span>
              </span>
            ))}
            <span className="trace-step done">{debug.trace.at(-1)?.next ?? 'DONE'}</span>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
            Limits: at most {debug.limits.maxSteps} steps, {debug.limits.maxLlmAttempts} model attempts, {debug.limits.maxRepairs} JSON repair.
            Total {debug.totalMs} ms.
          </p>
        </div>

        {r ? (
          <>
            <div>
              <h4 className="section-title">Retrieval: {r.method}</h4>
              <div className="stats">
                <Stat value={r.corpusChunks} label="chunks in knowledge base" />
                <Stat value={r.candidates} label="candidates scored (n)" />
                <Stat value={`${r.returned} / ${r.requestedK}`} label="selected / requested K" />
                <Stat value={r.heapReplacements} label="heap root replacements" />
                <Stat value={r.rejected.invalid} label="invalid scores rejected" />
                <Stat value={r.rejected.duplicate} label="duplicates rejected" />
                {r.coverage && <Stat value={`${r.coverage.covered}/${r.coverage.total}`} label="question terms found" />}
                <Stat value={`${r.selectMs} ms`} label="heap selection time" />
              </div>
              <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
                Query terms: <span className="mono">{r.queryTerms.join(', ') || '(none)'}</span>
                {r.coverage?.uncovered?.length > 0 && (
                  <>
                    {' '}· not found: <span className="mono">{r.coverage.uncovered.join(', ')}</span>
                  </>
                )}
              </p>
            </div>

            {evidence.length > 0 && (
              <div>
                <h4 className="section-title">Top-K from the bounded min-heap (descending; ties by doc ID, then chunk ID)</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Document</th>
                        <th>Section</th>
                        <th>Chunk</th>
                        <th style={{ textAlign: 'right' }}>BM25 score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.map((e) => (
                        <tr key={e.ref}>
                          <td>{e.ref}</td>
                          <td className="mono">{e.docId}</td>
                          <td>{e.sectionTitle}</td>
                          <td className="mono">{e.chunkId}</td>
                          <td className="num">{e.score.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="muted">Retrieval did not run (the request stopped at validation).</p>
        )}

        <div>
          <h4 className="section-title">Model</h4>
          <p style={{ margin: 0, fontSize: 14 }}>
            {llm.model ? <span className="mono">{llm.model}</span> : <span className="muted">not called</span>}
            {llm.ms != null && <> · {(llm.ms / 1000).toFixed(1)} s</>}
            {' '}· calls: {llm.calls} · repairs: {llm.repairs}
          </p>
          {llm.errors.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13.5 }}>
              {llm.errors.map((e, i) => (
                <li key={i}>
                  attempt {e.attempt}: <span className="mono">{e.kind}</span> {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  )
}
