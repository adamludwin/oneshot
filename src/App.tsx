import { useState, useEffect, useCallback } from 'react'
import './App.css'

const API = '/api'

interface DashboardItem {
  title: string
  subtitle?: string
  description: string
  category: string
  urgency: 'high' | 'medium' | 'low'
  type: 'event' | 'deadline' | 'action' | 'info'
}

interface DashboardSection {
  title: string
  items: DashboardItem[]
}

interface Alert {
  text: string
  urgency: 'high' | 'medium'
}

interface Dashboard {
  summary: string
  alerts?: Alert[]
  sections: DashboardSection[]
}

interface ScreenshotFile {
  name: string
  size: number
  modified: string
}

const CATEGORY_ICONS: Record<string, string> = {
  sports: '⚽',
  school: '📚',
  work: '💼',
  social: '🎉',
  health: '🏥',
  finance: '💰',
  family: '👨‍👩‍👧‍👦',
  other: '📌',
}

const TYPE_LABELS: Record<string, string> = {
  event: 'Event',
  deadline: 'Due',
  action: 'To-Do',
  info: 'FYI',
}

function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [screenshots, setScreenshots] = useState<ScreenshotFile[]>([])
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async () => {
    try {
      const [dashRes, ssRes] = await Promise.all([
        fetch(`${API}/dashboard`),
        fetch(`${API}/screenshots`),
      ])
      const dashData = await dashRes.json()
      const ssData = await ssRes.json()
      setDashboard(dashData.dashboard)
      setAnalyzedAt(dashData.analyzedAt)
      setScreenshots(ssData)
    } catch {
      // Server probably not running yet
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  const runAnalysis = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch(`${API}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDashboard(data.dashboard)
      setAnalyzedAt(new Date().toISOString())
      // Refresh screenshots list
      const ssRes = await fetch(`${API}/screenshots`)
      setScreenshots(await ssRes.json())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">oneshot</h1>
          <span className="tagline">screenshot it. forget it. we got it.</span>
        </div>
        <div className="header-right">
          <div className="screenshot-count">
            <span className="count-num">{screenshots.length}</span>
            <span className="count-label">screenshots</span>
          </div>
          <button
            className={`analyze-btn ${analyzing ? 'analyzing' : ''}`}
            onClick={runAnalysis}
            disabled={analyzing}
          >
            {analyzing ? (
              <>
                <span className="spinner" />
                Analyzing...
              </>
            ) : (
              'Analyze'
            )}
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      {/* Main Content */}
      <main className="main">
        {!dashboard ? (
          <div className="empty-state">
            <div className="empty-icon">📸</div>
            <h2>Drop screenshots, get clarity</h2>
            <p>
              Dump screenshots into the <code>/screenshots</code> folder — texts, emails,
              team apps, school notices, whatever — then hit <strong>Analyze</strong>.
            </p>
            <p className="empty-sub">
              We'll extract every event, deadline, and to-do into one clean view.
            </p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="summary-card">
              <p className="summary-text">{dashboard.summary}</p>
              {analyzedAt && (
                <span className="summary-time">Updated {timeAgo(analyzedAt)}</span>
              )}
            </div>

            {/* Alerts */}
            {dashboard.alerts && dashboard.alerts.length > 0 && (
              <div className="alerts">
                {dashboard.alerts.map((alert, i) => (
                  <div key={i} className={`alert alert-${alert.urgency}`}>
                    <span className="alert-icon">⚡</span>
                    {alert.text}
                  </div>
                ))}
              </div>
            )}

            {/* Sections */}
            {dashboard.sections.map((section, si) => (
              <section key={si} className="section">
                <h2 className="section-title">{section.title}</h2>
                <div className="cards">
                  {section.items.map((item, ii) => (
                    <div key={ii} className={`card card-${item.urgency}`}>
                      <div className="card-header">
                        <span className="card-category">
                          {CATEGORY_ICONS[item.category] || '📌'} {item.category}
                        </span>
                        <span className={`card-type type-${item.type}`}>
                          {TYPE_LABELS[item.type] || item.type}
                        </span>
                      </div>
                      <h3 className="card-title">{item.title}</h3>
                      {item.subtitle && (
                        <p className="card-subtitle">{item.subtitle}</p>
                      )}
                      <p className="card-desc">{item.description}</p>
                      {item.urgency === 'high' && (
                        <div className="card-urgent-badge">Needs attention</div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      {/* Screenshot Drawer */}
      {screenshots.length > 0 && (
        <aside className="screenshot-bar">
          <h3 className="bar-title">Sources ({screenshots.length})</h3>
          <div className="screenshot-thumbs">
            {screenshots.map((ss) => (
              <img
                key={ss.name}
                src={`${API}/screenshots/${ss.name}`}
                alt={ss.name}
                className="thumb"
                title={ss.name}
              />
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}

export default App
