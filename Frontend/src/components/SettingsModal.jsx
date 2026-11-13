import React from 'react'
import { X, Sliders, Server, Shield, Layers } from 'lucide-react'

export default function SettingsModal({
  k,
  setK,
  simulate,
  setSimulate,
  demoFailures,
  docFilter,
  setDocFilter,
  docs,
  myDocs,
  h,
  onClose,
}) {
  const modelInfo = h?.data?.model
  const kbInfo = h?.data?.knowledgeBase

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Sliders size={18} className="text-cyan-400" />
            <h3 className="modal-title">Settings & Pipeline Parameters</h3>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Top-K Selection */}
          <div className="setting-field">
            <div className="setting-label-row">
              <label htmlFor="k-slider" className="setting-label">
                Evidence Passages (Top-K): <strong className="text-cyan-400">{k}</strong>
              </label>
              <span className="setting-hint">Bounded Min-Heap capacity O(n log K)</span>
            </div>
            <input
              id="k-slider"
              type="range"
              min="1"
              max="10"
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
              className="range-slider"
            />
          </div>

          {/* Document Scope Filter */}
          {(docs.length > 1 || myDocs.length > 0) && (
            <div className="setting-field">
              <label htmlFor="doc-filter" className="setting-label">
                Search Scope Filter:
              </label>
              <select
                id="doc-filter"
                value={docFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                className="select-input"
              >
                <option value="">All Documents (Combined Index)</option>
                {docs.map((d) => (
                  <option key={d.docId} value={d.docId}>
                    {d.title}
                  </option>
                ))}
                {myDocs.length > 0 && (
                  <optgroup label="Your Private Documents">
                    {myDocs.map((d) => (
                      <option key={d.docId} value={d.docId}>
                        {d.title} (Session)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {/* Failure Simulation */}
          {demoFailures && (
            <div className="setting-field">
              <label htmlFor="sim-select" className="setting-label">
                Hackathon Failure Simulation:
              </label>
              <select
                id="sim-select"
                value={simulate}
                onChange={(e) => setSimulate(e.target.value)}
                className="select-input"
              >
                <option value="">Normal Operation</option>
                <option value="model">Simulate Model Outage (503 Fallback)</option>
                <option value="retrieval">Simulate Search Outage (500 Fallback)</option>
              </select>
            </div>
          )}

          {/* System & Model Status Info */}
          <div className="system-status-box">
            <h4 className="status-box-title">System & Index Telemetry</h4>
            <div className="status-grid">
              <div className="status-grid-item">
                <span className="grid-label">Knowledge Base:</span>
                <span className="grid-value text-emerald-400">
                  {kbInfo?.chunks ?? 53} statutory chunks
                </span>
              </div>
              <div className="status-grid-item">
                <span className="grid-label">Active Model:</span>
                <span className="grid-value text-cyan-300">
                  {modelInfo?.model || 'qwen2.5:3b / groq'}
                </span>
              </div>
              <div className="status-grid-item">
                <span className="grid-label">Model Status:</span>
                <span className={`grid-value ${modelInfo?.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {modelInfo?.ok ? 'Online' : 'Offline / BM25 Direct Fallback'}
                </span>
              </div>
              <div className="status-grid-item">
                <span className="grid-label">Retrieval Gate:</span>
                <span className="grid-value">Min 60% coverage threshold</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-primary-modal" onClick={onClose}>
            Apply & Close
          </button>
        </div>
      </div>
    </div>
  )
}
