import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')

const args = process.argv.slice(2)
const portIdx = args.indexOf('--port') !== -1 ? args.indexOf('--port') : args.indexOf('-p')
const argPort = portIdx !== -1 && args[portIdx + 1] ? Number(args[portIdx + 1]) : null
const PORT = Number(process.env.PORT) || argPort || 4173

// Optional backend URL to forward /api requests to when frontend is deployed separately
const BACKEND_URL = (process.env.BACKEND_URL || process.env.VITE_API_TARGET || '').replace(/\/+$/, '')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
}

const server = http.createServer((req, res) => {
  // Simple health check endpoint
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', preview: true }))
    return
  }

  const cleanUrl = req.url.split('?')[0]

  // If request is targeting an API route:
  if (cleanUrl.startsWith('/api/')) {
    if (BACKEND_URL) {
      // Proxy to backend service
      const targetUrl = new URL(req.url, BACKEND_URL)
      const proxyReq = http.request(
        targetUrl,
        {
          method: req.method,
          headers: { ...req.headers, host: targetUrl.host },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers)
          proxyRes.pipe(res, { end: true })
        }
      )
      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, status: 'bad_gateway', message: `Cannot reach backend: ${err.message}` }))
      })
      req.pipe(proxyReq, { end: true })
      return
    }

    // Backend not configured on preview server: NEVER return HTML index.html
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: false,
        status: 'backend_not_configured',
        message: 'Backend API not reachable. Set BACKEND_URL environment variable on the frontend service, or run the single-container Docker deployment.',
      })
    )
    return
  }

  let filePath = path.join(DIST, cleanUrl === '/' ? 'index.html' : cleanUrl)

  // SPA fallback: if file does not exist or is a directory, serve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html')
  }

  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME[ext] || 'application/octet-stream'

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(content)
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend preview server running on http://0.0.0.0:${PORT}${BACKEND_URL ? ` (proxying /api to ${BACKEND_URL})` : ''}`)
})
