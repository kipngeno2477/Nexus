// Thin wrapper around the backend API. Every call resolves to { ok, status, data } —
// network failures are reported, never thrown, so the UI can always show a state.

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
  try {
    const res = await fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', ...(sid ? { 'x-session-id': sid } : {}), ...options.headers },
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      data = { message: `Unexpected response (${res.status})` }
    }
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: { status: 'network_error', message: 'Cannot reach the server. Check your connection or that the backend is running.', detail: e.message },
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
  if (r.ok && r.data.sessionId) setSessionId(r.data.sessionId)
  return r
}
export const removeMyDocument = (docId) => request(`/api/session/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' })
