import React from 'react'
import { Search, ShieldAlert, CheckCircle2, AlertCircle } from 'lucide-react'
import Answer from './Answer.jsx'
import Sources from './Sources.jsx'
import StatusBanner from './StatusBanner.jsx'
import RetrievalDetails from './RetrievalDetails.jsx'

export default function ActiveChatCard({
  activeQuestion,
  loading,
  elapsed,
  result,
  hasPipelineResult,
  citedRefs,
  activeRef,
  onCite,
  setPassage,
  showAllSources,
  setShowAllSources,
  showSourcesOnly,
}) {
  const displayQuestion =
    activeQuestion || (result ? result.question : 'Am I protected if I disclose information about corruption?')

  return (
    <div className="active-chat-container">
      {/* User / Bot Message Header */}
      <div className="chat-message-row">
        <div className="nexus-avatar" aria-hidden="true">
          <span>N</span>
        </div>
        <div className="chat-message-body">
          <h3 className="chat-query-text">{displayQuestion}</h3>
          <p className="chat-query-subtext">
            {loading
              ? 'Analyzing Kenya statutory law and cross-referencing legal sections…'
              : result
              ? 'Information retrieved and grounded in statutory sections:'
              : "Let's find the relevant information from the Access to Information Act, 2016…"}
          </p>
        </div>
      </div>

      {/* Loading & Retrieval Search Bar Indicator */}
      {loading && (
        <div className="searching-indicator-row" aria-live="polite">
          <div className="searching-label">
            <Search size={15} className="search-icon-pulse" />
            <span>Searching relevant sections…</span>
          </div>
          <div className="search-progress-bar-track">
            <div className="search-progress-bar-fill" />
          </div>
          <div className="search-elapsed-badge">{elapsed}s</div>
        </div>
      )}

      {/* Answer & Results Section */}
      {result && !loading && (
        <div className="results-wrapper">
          <StatusBanner
            status={result.status}
            message={result.status === 'answered' ? null : result.message}
          />

          {hasPipelineResult && result.status !== 'invalid_input' && (
            <div className="answer-section">
              <Answer result={result} activeRef={activeRef} onCite={onCite} />
            </div>
          )}

          {hasPipelineResult && result.evidence && result.evidence.length > 0 && (
            <div className="sources-section">
              <div className="sources-header">
                <h4 className="sources-title">
                  {showSourcesOnly || showAllSources
                    ? `Retrieved Passages (${result.evidence.length})`
                    : `Verified Sources (${citedRefs.size})`}
                </h4>
                {!showSourcesOnly && result.evidence.length > citedRefs.size && (
                  <button
                    type="button"
                    className="btn-sources-toggle"
                    onClick={() => setShowAllSources((s) => !s)}
                  >
                    {showAllSources ? 'Show Cited Only' : `Show All ${result.evidence.length} Passages`}
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

          {hasPipelineResult && result.debug && (
            <div className="details-section">
              <RetrievalDetails result={result} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
