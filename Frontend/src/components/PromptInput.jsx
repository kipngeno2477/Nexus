import React, { useRef } from 'react'
import { Sparkles, Paperclip, ArrowUpRight, X } from 'lucide-react'

export default function PromptInput({
  question,
  setQuestion,
  onSubmit,
  onCancel,
  loading,
  onOpenUpload,
  hasPrivateDocs,
  maxChars = 500,
}) {
  const inputRef = useRef(null)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (question.trim() && !loading) {
        onSubmit()
      }
    }
  }

  return (
    <form
      className="prompt-input-bar"
      onSubmit={(e) => {
        e.preventDefault()
        if (question.trim() && !loading) onSubmit()
      }}
    >
      {/* Left Glowing Sparkle Icon */}
      <div className="sparkle-prefix" aria-hidden="true">
        <Sparkles size={20} className="sparkle-icon-cyan" />
      </div>

      {/* Input Field */}
      <input
        ref={inputRef}
        type="text"
        className="prompt-text-input"
        value={question}
        onChange={(e) => setQuestion(e.target.value.slice(0, maxChars))}
        onKeyDown={handleKeyDown}
        placeholder="How much does a cost to request information?"
        disabled={loading}
        aria-label="Ask about Kenya law"
      />

      {/* Action Buttons */}
      <div className="prompt-actions-right">
        {/* Attachment / Upload Button */}
        <button
          type="button"
          className={`btn-attachment ${hasPrivateDocs ? 'has-docs' : ''}`}
          onClick={onOpenUpload}
          title="Upload or paste your own county bylaw or document"
          disabled={loading}
        >
          <Paperclip size={18} />
          {hasPrivateDocs && <span className="doc-attached-indicator" />}
        </button>

        {/* Submit or Cancel Button */}
        {loading ? (
          <button
            type="button"
            className="btn-cancel"
            onClick={onCancel}
            title="Cancel question request"
          >
            <X size={16} />
            <span>Cancel</span>
          </button>
        ) : (
          <button
            type="submit"
            className="btn-ask-glow"
            disabled={!question.trim()}
            title="Ask question"
          >
            <span>Ask</span>
            <ArrowUpRight size={17} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </form>
  )
}
