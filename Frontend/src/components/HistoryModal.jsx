import React from 'react'
import { X, Clock, ArrowRight, Trash2 } from 'lucide-react'

export default function HistoryModal({ history, onSelectQuery, onClearHistory, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Clock size={18} className="text-cyan-400" />
            <h3 className="modal-title">Inquiry History</h3>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {history.length === 0 ? (
            <p className="empty-history-text">
              No questions asked yet in this session. Ask a question to view history here!
            </p>
          ) : (
            <div className="history-list">
              {history.map((item, idx) => (
                <div
                  key={idx}
                  className="history-item-row"
                  onClick={() => {
                    onSelectQuery(item.question)
                    onClose()
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="history-item-content">
                    <span className="history-item-q">{item.question}</span>
                    <span className="history-item-time">{item.timestamp}</span>
                  </div>
                  <ArrowRight size={14} className="history-arrow" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer history-footer">
          {history.length > 0 && (
            <button
              type="button"
              className="btn-clear-history"
              onClick={onClearHistory}
            >
              <Trash2 size={14} />
              <span>Clear History</span>
            </button>
          )}
          <button type="button" className="btn-primary-modal" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
