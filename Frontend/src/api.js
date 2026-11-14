// Thin wrapper around the backend API. Every call resolves to { ok, status, data } —
// network failures are reported, never thrown, so the UI can always show a state.

// Backend location, in priority order:
//   1. window.__NEXUS_API_URL__ (injected at runtime by the static server)
//   2. VITE_API_BASE_URL (set at build time)
//   3. dev server (npm run dev): same origin, so Vite's /api proxy reaches the LOCAL backend
//   4. production build: the deployed backend
const API_BASE = (
  typeof window !== 'undefined' && window.__NEXUS_API_URL__
    ? window.__NEXUS_API_URL__
    : import.meta.env?.VITE_API_BASE_URL || (import.meta.env?.DEV ? '' : 'https://backend.primecloud.cloud')
).replace(/\/+$/, '')

// Private-document session id (issued by the server on first private upload).
// Kept in sessionStorage so it lasts for this tab only; falls back to memory if storage is blocked.
const SESSION_KEY = 'nexus-session-id'
let memorySessionId = null

export function getSessionId() {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? memorySessionId
  } catch {
    return memorySessionId
  }
}

export function setSessionId(id) {
  memorySessionId = id
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* memory fallback only */
  }
}

async function request(path, options = {}) {
  const sid = getSessionId()
  const fullUrl = path.startsWith('http') ? path : `${API_BASE}${path}`

  try {
    const res = await fetch(fullUrl, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(sid ? { 'x-session-id': sid } : {}),
        ...options.headers,
      },
    })

    const contentType = res.headers.get('content-type') || ''
    let data = null

    if (contentType.includes('application/json')) {
      try {
        data = await res.json()
      } catch {
        data = { message: `Malformed JSON response (${res.status})` }
      }
    } else {
      // Received HTML or other non-JSON response (e.g. 404/502 page from frontend host)
      return {
        ok: false,
        status: res.status,
        data: {
          status: 'invalid_response',
          message: `Expected JSON but received ${contentType || 'HTML'}. Make sure the backend service is running and accessible at ${API_BASE}.`,
        },
      }
    }

    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: {
        status: 'network_error',
        message: `Cannot reach the backend server at ${API_BASE}. Check your connection or backend URL.`,
        detail: e.message,
      },
    }
  }
}

export function ask({ question, k, simulate, docIds }, signal) {
  const qs = simulate ? `?simulate=${encodeURIComponent(simulate)}` : ''
  const body = { question, k, ...(docIds?.length ? { docIds } : {}) }
  return request(`/api/ask${qs}`, { method: 'POST', body: JSON.stringify(body), signal })
}

export const health = () => request('/api/health')
export const listDocuments = () => request('/api/documents')
export const listChunks = (docId) => request(`/api/documents/${encodeURIComponent(docId)}/chunks`)
export const getChunk = (docId, chunkId) =>
  request(`/api/documents/${encodeURIComponent(docId)}/chunks/${encodeURIComponent(chunkId)}`)
const tokenHeader = (token) => (token ? { 'x-upload-token': token } : {})
export const uploadDocument = (doc, token) =>
  request('/api/documents', { method: 'POST', body: JSON.stringify(doc), headers: tokenHeader(token) })
export const deleteDocument = (docId, token) =>
  request(`/api/documents/${encodeURIComponent(docId)}`, { method: 'DELETE', headers: tokenHeader(token) })

// Private documents (this browser session only)
export const listMyDocuments = () => request('/api/session/documents')
export async function addMyDocument(doc) {
  const r = await request('/api/session/documents', { method: 'POST', body: JSON.stringify(doc) })
  if (r.ok && r.data?.sessionId) setSessionId(r.data.sessionId)
  return r
}
export const removeMyDocument = (docId) =>
  request(`/api/session/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' })
