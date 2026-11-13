import React from 'react'
import { MessageSquare, Clock, BookOpen, Settings, Info, Sparkles, ChevronRight } from 'lucide-react'

export default function Sidebar({
  onNewChat,
  onOpenHistory,
  onOpenKb,
  onOpenSettings,
  onOpenAbout,
  activeTab = 'chat',
  online = true,
}) {
  return (
    <aside className="nexus-sidebar">
      {/* Brand Header */}
      <div className="sidebar-brand" onClick={onNewChat} role="button" tabIndex={0} title="Start new conversation">
        <div className="brand-icon-squircle">
          <span className="brand-letter">N</span>
        </div>
        <div className="brand-text">
          <h1 className="brand-name">Nexus</h1>
          <p className="brand-subtitle">Legal AI Assistant</p>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="sidebar-nav">
        {/* New Chat Primary Action */}
        <button
          type="button"
          className="nav-btn nav-btn-new-chat"
          onClick={onNewChat}
          title="Start fresh conversation"
        >
          <div className="nav-icon-wrap">
            <MessageSquare size={17} className="text-cyan-400" />
          </div>
          <span>New Chat</span>
        </button>

        {/* Navigation Links */}
        <div className="nav-group">
          <button
            type="button"
            className={`nav-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={onOpenHistory}
          >
            <Clock size={17} className="nav-icon" />
            <span>History</span>
          </button>

          <button
            type="button"
            className={`nav-btn ${activeTab === 'kb' ? 'active' : ''}`}
            onClick={onOpenKb}
          >
            <BookOpen size={17} className="nav-icon" />
            <span>Knowledge Base</span>
          </button>

          <button
            type="button"
            className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={onOpenSettings}
          >
            <Settings size={17} className="nav-icon" />
            <span>Settings</span>
          </button>

          <button
            type="button"
            className={`nav-btn ${activeTab === 'about' ? 'active' : ''}`}
            onClick={onOpenAbout}
          >
            <Info size={17} className="nav-icon" />
            <span>About</span>
          </button>
        </div>
      </nav>

      {/* Promo Card: Get the most from Nexus */}
      <div className="sidebar-promo-card">
        <div className="promo-sparkle">
          <Sparkles size={16} />
        </div>
        <h4 className="promo-title">Get the most from Nexus</h4>
        <p className="promo-desc">Ask clear questions and get precise answers.</p>
        <button
          type="button"
          className="promo-btn"
          onClick={onOpenAbout}
        >
          <span>Learn More</span>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Online Status Footer */}
      <div className="sidebar-footer">
        <div className="status-indicator">
          <span className={`status-dot ${online ? 'online' : 'offline'}`} />
          <div className="status-meta">
            <span className="status-text">{online ? 'Online' : 'Offline'}</span>
            <span className="status-subtext">{online ? 'Ready to help' : 'Connecting…'}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
