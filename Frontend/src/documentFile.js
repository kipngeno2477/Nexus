// Turns a user-picked file into plain text for ingestion.
//
// .txt / .md are read as text. PDFs are converted IN THE BROWSER with pdf.js, so the file itself
// never leaves the user's machine: only the extracted text is sent, through the same upload path
// as text files, and the backend's cleaning (page numbers, running headers, hyphenation) applies.
// Scanned PDFs (images, no text layer) are detected and rejected: OCR is out of scope.

export const LIMITS = {
  textFileBytes: 900_000, // .txt / .md
  pdfFileBytes: 15 * 1024 * 1024, // 15 MB PDF
  pdfMaxPages: 300,
}

export const ACCEPT = '.txt,.md,.pdf,text/plain,text/markdown,application/pdf'

export class DocumentFileError extends Error {}

const kind = (file) =>
  /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
    ? 'pdf'
    : /\.(txt|md)$/i.test(file.name)
      ? 'text'
      : null

/** "Nairobi County Bylaw (2023).pdf" → "Nairobi County Bylaw (2023).txt" (server-safe name) */
export function textFileName(name) {
  const stem = String(name).replace(/\.[^.]+$/, '').replace(/[^\w .()-]/g, '_').trim().slice(0, 90) || 'document'
  return `${stem}.txt`
}

/** "county-waste_bylaw-2023.pdf" → "County waste bylaw 2023" */
export function titleFromFileName(name) {
  const t = String(name).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Untitled document'
}

/** PDF metadata titles are often junk ("Untitled", "Microsoft Word - doc1.docx", "Slide 1"). */
export function usablePdfTitle(raw) {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (t.length < 4 || t.length > 160) return null
  if (/^(untitled|document\d*|slide \d+|print|scan\w*|\d+)$/i.test(t)) return null
  if (/^microsoft (word|powerpoint|excel)\s*-/i.test(t) || /\.(docx?|pdf|txt|rtf)$/i.test(t)) return null
  return t
}

let pdfjsPromise = null
function loadPdfJs() {
  // Loaded on first use only, so the page stays light for everyone else.
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    }
  )
  return pdfjsPromise
}

/**
 * Rebuilds reading-order lines from pdf.js text items: items are grouped into lines by their
 * baseline (y) and ordered left to right; a gap between items becomes a space.
 */
function pageToLines(items) {
  const rows = []
  for (const it of items) {
    if (typeof it.str !== 'string') continue
    const [, , , , x, y] = it.transform
    const h = Math.abs(it.transform[3]) || it.height || 10
    let row = rows.find((r) => Math.abs(r.y - y) <= h * 0.5)
    if (!row) rows.push((row = { y, h, items: [] }))
    row.items.push({ x, w: it.width ?? 0, str: it.str })
  }
  rows.sort((a, b) => b.y - a.y) // PDF y grows upwards
  return rows
    .map((r) => {
      r.items.sort((a, b) => a.x - b.x)
      let line = ''
      let end = null
      for (const it of r.items) {
        const gap = end == null ? 0 : it.x - end
        if (line && gap > r.h * 0.15 && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' '
        line += it.str
        end = it.x + it.w
      }
      return line.replace(/\s+/g, ' ').trim()
    })
    .filter(Boolean)
}

/**
 * Removes running headers/footers using page structure: a line among the first/last two lines of
 * a page whose shape (digits ignored, so "Page 3 of 17" ~ "Page 4 of 17") recurs on at least half
 * of the pages. Plain-text cleaning on the server can't see page boundaries; PDFs can.
 */
export function stripRunningHeadersFooters(pages) {
  if (pages.length < 2) return { pages, removed: 0 }
  const shape = (l) => l.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()
  const edge = (lines) => [...new Set([...lines.slice(0, 2), ...lines.slice(-2)].map(shape))]
  const counts = new Map()
  for (const lines of pages) for (const k of edge(lines)) counts.set(k, (counts.get(k) ?? 0) + 1)
  const minPages = Math.max(2, Math.ceil(pages.length / 2))
  const running = new Set([...counts].filter(([k, n]) => n >= minPages && k.length > 0).map(([k]) => k))
  let removed = 0
  const out = pages.map((lines) =>
    lines.filter((l, i) => {
      const atEdge = i < 2 || i >= lines.length - 2
      if (atEdge && running.has(shape(l))) {
        removed++
        return false
      }
      return true
    })
  )
  return { pages: out, removed }
}

async function pdfToText(file, onProgress) {
  const pdfjs = await loadPdfJs()
  // Keep the loading task: destroying it releases the document and its worker resources
  // (PDFDocumentProxy.destroy() no longer exists in pdf.js 6).
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    task.destroy()
    if (e?.name === 'PasswordException') throw new DocumentFileError('This PDF is password-protected. Remove the password and try again.')
    throw new DocumentFileError('This file could not be read as a PDF. It may be damaged.')
  }
  try {
    if (doc.numPages > LIMITS.pdfMaxPages)
      throw new DocumentFileError(`This PDF has ${doc.numPages} pages; the limit is ${LIMITS.pdfMaxPages}.`)
    const pages = []
    let pagesWithText = 0
    for (let p = 1; p <= doc.numPages; p++) {
      onProgress?.({ page: p, pages: doc.numPages })
      const page = await doc.getPage(p)
      const lines = pageToLines((await page.getTextContent()).items)
      if (lines.join('').replace(/\s/g, '').length > 20) pagesWithText++
      pages.push(lines)
      page.cleanup()
    }
    const stripped = stripRunningHeadersFooters(pages)
    let metaTitle = null
    try {
      metaTitle = usablePdfTitle((await doc.getMetadata())?.info?.Title)
    } catch {
      /* metadata is optional */
    }
    const text = stripped.pages.map((lines) => lines.join('\n')).join('\n\n')
    if (pagesWithText === 0 || text.replace(/\s/g, '').length < 50)
      throw new DocumentFileError(
        'No selectable text found. This looks like a scanned PDF (images only), which is not supported. Use a PDF with selectable text, or paste the text instead.'
      )
    return { text, pages: doc.numPages, pagesWithText, headerFooterLinesRemoved: stripped.removed, metaTitle }
  } finally {
    await task.destroy()
  }
}

/**
 * @param {File} file
 * @param {{ maxTextChars?: number, onProgress?: (p: {page:number, pages:number}) => void }} opts
 * @returns {Promise<{ fileName: string, text: string, title?: string, sourceFormat: 'pdf'|'text', originalName: string, pages?: number, pagesWithText?: number, headerFooterLinesRemoved?: number }>}
 */
export async function readDocumentFile(file, { maxTextChars, onProgress } = {}) {
  const k = kind(file)
  if (!k) throw new DocumentFileError('Please choose a .pdf, .txt or .md file. Word documents: save as PDF or plain text first.')

  if (k === 'text') {
    if (file.size > LIMITS.textFileBytes) throw new DocumentFileError(`File is too large (max ${Math.round(LIMITS.textFileBytes / 1000)} KB).`)
    const text = await file.text()
    if (maxTextChars && text.length > maxTextChars)
      throw new DocumentFileError(`Document is too long (${text.length.toLocaleString()} characters; max ${maxTextChars.toLocaleString()}).`)
    return { fileName: file.name.replace(/[^\w .()-]/g, '_'), text, sourceFormat: 'text', originalName: file.name }
  }

  if (file.size > LIMITS.pdfFileBytes) throw new DocumentFileError(`PDF is too large (max ${LIMITS.pdfFileBytes / 1024 / 1024} MB).`)
  const { text, pages, pagesWithText, headerFooterLinesRemoved, metaTitle } = await pdfToText(file, onProgress)
  if (maxTextChars && text.length > maxTextChars)
    throw new DocumentFileError(
      `This PDF contains ${text.length.toLocaleString()} characters of text; the limit is ${maxTextChars.toLocaleString()}. Try a shorter document or split it.`
    )
  // Title: the PDF's own metadata title when it looks real, else the file name (the first line of a
  // PDF is often a gazette notice or a cover-page artefact rather than the document's name).
  const title = metaTitle ?? titleFromFileName(file.name)
  return { fileName: textFileName(file.name), text, title, sourceFormat: 'pdf', originalName: file.name, pages, pagesWithText, headerFooterLinesRemoved }
}
