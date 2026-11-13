import React from 'react'
import { CheckCircle2, ShieldCheck, FileCheck, Layers } from 'lucide-react'

// Displays data cleaning and noise-removal metrics for ingested legal documents.
export default function IngestReport({ report }) {
  if (!report) return null

  const metrics = [
    { label: 'Sections detected', value: report.sections, color: 'text-cyan-400' },
    { label: 'Chunks indexed', value: report.chunks, color: 'text-emerald-400' },
    { label: 'Total word count', value: report.words?.toLocaleString(), color: 'text-white' },
    { label: 'Page numbers stripped', value: report.pageNumbersRemoved, color: 'text-gray-300' },
    { label: 'Repeated headers/footers cleaned', value: report.repeatedLinesRemoved, color: 'text-gray-300' },
    { label: 'Hyphenated line-breaks joined', value: report.hyphenationsJoined, color: 'text-gray-300' },
    { label: 'Clause markers joined to text', value: report.clauseMarkersJoined, color: 'text-gray-300' },
    { label: 'Control characters purged', value: report.controlCharsRemoved, color: 'text-gray-300' },
  ]

  return (
    <div className="ingest-report-panel">
      <div className="ingest-report-title-row">
        <ShieldCheck size={16} className="text-cyan-400" />
        <h5 className="ingest-report-heading">Document Cleaning & Ingestion Telemetry</h5>
      </div>

      <div className="ingest-report-grid">
        {metrics.map((m) => (
          <div key={m.label} className="ingest-metric-card">
            <span className="ingest-metric-label">{m.label}</span>
            <span className={`ingest-metric-val mono ${m.color}`}>{m.value ?? 0}</span>
          </div>
        ))}
      </div>

      {report.repeatedLineSamples?.length > 0 && (
        <div className="ingest-report-note">
          <strong>Cleaned running headers:</strong>{' '}
          {report.repeatedLineSamples.map((s) => `“${s}”`).join(', ')}
        </div>
      )}

      {!report.headingsDetected && (
        <div className="ingest-report-warning">
          No section headings were detected. The document was split into fixed-length windows, so
          citations link to chunk identifiers.
        </div>
      )}
    </div>
  )
}
