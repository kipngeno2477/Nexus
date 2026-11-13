// What ingestion did to a document: structure found and noise removed.
export default function IngestReport({ report }) {
  if (!report) return null
  const rows = [
    ['Sections detected', report.sections],
    ['Chunks indexed', report.chunks],
    ['Words', report.words?.toLocaleString()],
    ['Page numbers removed', report.pageNumbersRemoved],
    ['Repeated header/footer lines removed', report.repeatedLinesRemoved],
    ['Hyphenated line breaks repaired', report.hyphenationsJoined],
    ['Clause markers joined to their text', report.clauseMarkersJoined],
    ['Control characters removed', report.controlCharsRemoved],
  ]
  return (
    <div className="report">
      <div className="report-grid">
        {rows.map(([label, v]) => (
          <div key={label} className="report-row">
            <span>{label}</span>
            <span className="mono">{v ?? 0}</span>
          </div>
        ))}
      </div>
      {report.repeatedLineSamples?.length > 0 && (
        <p className="muted report-note">
          Removed as running headers: {report.repeatedLineSamples.map((s) => `“${s}”`).join(', ')}
        </p>
      )}
      {!report.headingsDetected && (
        <p className="report-note" style={{ color: 'var(--warn)' }}>
          No section headings detected. The document was split by length, so citations point to chunks, not sections.
        </p>
      )}
    </div>
  )
}
