import React from 'react'
import { ShieldCheck, BookOpen, ChevronDown } from 'lucide-react'

export default function TopNav({ onOpenKb, chunksCount, modelName }) {
  return (
    <header className="nexus-top-nav">
      {/* Trust Badge */}
      <div className="trust-pill" title="Verified against statutory Kenya legislation">
        <ShieldCheck size={16} className="trust-icon" />
        <span className="trust-text">Trusted Legal Information • 24/7</span>
      </div>

      {/* Right Actions */}
      <div className="top-nav-actions">
        <button
          type="button"
          className="btn-kb-dropdown"
          onClick={onOpenKb}
          title="Open statutory knowledge base documents"
        >
          <BookOpen size={16} className="kb-icon" />
          <span className="kb-label">Knowledge Base</span>
          <ChevronDown size={14} className="kb-chevron" />
        </button>
      </div>
    </header>
  )
}
