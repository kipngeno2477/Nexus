import { Filter, X } from 'lucide-react'

/**
 * Visible "Search in" control next to the question bar. Questions can be limited to one
 * document (e.g. an uploaded bylaw); this makes that limit visible and one click to undo.
 * Hidden when there is only one document to search.
 */
export default function ScopeSelector({ docs, myDocs, value, onChange, disabled }) {
  const all = [...docs, ...myDocs]
  if (all.length < 2) return null
  const selected = all.find((d) => d.docId === value)

  return (
    <div className={`scope-bar ${selected ? 'is-filtered' : ''}`}>
      <Filter size={14} className="scope-icon" aria-hidden="true" />
      <label htmlFor="scope-select" className="scope-label">
        Search in
      </label>
      <select
        id="scope-select"
        className="scope-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">All documents ({all.length})</option>
        {docs.length > 0 && (
          <optgroup label="Knowledge base">
            {docs.map((d) => (
              <option key={d.docId} value={d.docId}>
                {d.title}
              </option>
            ))}
          </optgroup>
        )}
        {myDocs.length > 0 && (
          <optgroup label="Your documents (private)">
            {myDocs.map((d) => (
              <option key={d.docId} value={d.docId}>
                {d.title}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {selected && (
        <button
          type="button"
          className="scope-clear"
          onClick={() => onChange('')}
          disabled={disabled}
          title="Search all documents"
          aria-label="Search all documents"
        >
          <X size={13} />
          <span>Search all</span>
        </button>
      )}
    </div>
  )
}
