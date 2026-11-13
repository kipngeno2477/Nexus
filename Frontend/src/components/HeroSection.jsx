import React from 'react'
import heroMockup from '../assets/hero-mockup.jpg'

export default function HeroSection({ scopeText }) {
  return (
    <section className="nexus-hero-section">
      <div className="hero-text-content">
        <h2 className="hero-main-title">
          Ask about the<br />
          law in <span className="highlight-text">plain language</span>
        </h2>
        <p className="hero-description">
          Access accurate information from the Access to Information Act, 2016 (Kenya).
          Every statement links to the section in the Act. If the documents don't cover your question,
          Nexus says so instead of guessing.
        </p>
      </div>

      <div className="hero-artwork-container" aria-hidden="true">
        <div className="hero-artwork-crop">
          <img
            src={heroMockup}
            alt="Nexus 3D Legal Scales and Kenya Legislation"
            className="hero-artwork-img"
          />
          <div className="hero-artwork-vignette" />
        </div>
      </div>
    </section>
  )
}
