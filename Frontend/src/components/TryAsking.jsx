import React from 'react'
import { Lightbulb, ArrowRight } from 'lucide-react'

const SUGGESTIONS = [
  'How much does it cost to request information?',
  'How long does a public body have to respond to my request?',
  'Who can I complain to if my request is refused?',
  'Am I protected if I disclose information about corruption?',
  'What information can be withheld?',
]

export default function TryAsking({ onSelect, disabled }) {
  return (
    <div className="try-asking-container">
      <div className="try-asking-header">
        <Lightbulb size={16} className="text-amber-400" />
        <span className="try-asking-title">Try asking:</span>
      </div>

      <div className="try-asking-chips-row">
        {SUGGESTIONS.map((item) => (
          <button
            key={item}
            type="button"
            className="suggestion-chip"
            disabled={disabled}
            onClick={() => onSelect(item)}
          >
            <span className="suggestion-text">{item}</span>
            <ArrowRight size={13} className="suggestion-arrow" />
          </button>
        ))}
      </div>
    </div>
  )
}
