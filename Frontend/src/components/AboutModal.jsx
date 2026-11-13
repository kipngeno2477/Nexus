import React from 'react'
import { X, ShieldCheck, Scale, Cpu, CheckCircle } from 'lucide-react'

export default function AboutModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Scale size={20} className="text-cyan-400" />
            <h3 className="modal-title">About Nexus – Legal AI Assistant</h3>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body about-body">
          <div className="about-hero-callout">
            <h4 className="callout-heading">Grounded Civic Intelligence for Kenya</h4>
            <p className="callout-p">
              Nexus empowers Kenyan citizens, community organizers, and businesses to query complex
              statutory laws in plain language, receiving exact, verifiable legal section citations.
            </p>
          </div>

          <div className="features-list">
            <div className="feature-item">
              <ShieldCheck className="feature-icon text-cyan-400" size={20} />
              <div>
                <strong>Zero-Hallucination Guardrails:</strong>
                <p>
                  Nexus answers ONLY from provided legal statutes. If information is missing or
                  uncovered, Nexus explicitly abstains rather than inventing legal rules.
                </p>
              </div>
            </div>

            <div className="feature-item">
              <Cpu className="feature-icon text-emerald-400" size={20} />
              <div>
                <strong>Bounded Binary Min-Heap Top-K:</strong>
                <p>
                  Strict algorithmic selection with O(n log K) time complexity and O(K) bounded
                  memory for candidate chunk ranking.
                </p>
              </div>
            </div>

            <div className="feature-item">
              <CheckCircle className="feature-icon text-purple-400" size={20} />
              <div>
                <strong>UN SDG 16 Alignment:</strong>
                <p>
                  Promotes peace, justice, and strong institutions by making public regulations,
                  fees, and statutory timelines accessible to all citizens.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-primary-modal" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
