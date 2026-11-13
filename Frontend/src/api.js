// Thin wrapper around the backend API. Every call resolves to { ok, status, data } —
// network failures are reported, never thrown, so the UI can always show a state.

async function request(path, options = {}) {
  try {
    const res = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...options,
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

export function ask({ question, k, simulate }, signal) {
  const qs = simulate ? `?simulate=${encodeURIComponent(simulate)}` : ''
  return request(`/api/ask${qs}`, { method: 'POST', body: JSON.stringify({ question, k }), signal })
}

export const health = () => request('/api/health')
export const listDocuments = () => request('/api/documents')
export const listChunks = (docId) => request(`/api/documents/${encodeURIComponent(docId)}/chunks`)
export const getChunk = (docId, chunkId) =>
  request(`/api/documents/${encodeURIComponent(docId)}/chunks/${encodeURIComponent(chunkId)}`)
export const uploadDocument = (doc) => request('/api/documents', { method: 'POST', body: JSON.stringify(doc) })
