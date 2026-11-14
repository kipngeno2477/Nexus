// Optional metadata about where an uploaded text came from (e.g. a PDF converted in the browser).
// The body is always plain text; this only describes its origin for display and provenance.

const FORMATS = new Set(["text", "pdf"]);

/** Returns a sanitised { sourceFormat, originalName, pages } or throws an error with status 400. */
export function sourceInfo({ sourceFormat, originalName, pages } = {}) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  const out = { sourceFormat: "text" };
  if (sourceFormat != null) {
    if (!FORMATS.has(sourceFormat)) throw bad('sourceFormat must be "text" or "pdf"');
    out.sourceFormat = sourceFormat;
  }
  if (originalName != null) {
    if (typeof originalName !== "string" || originalName.length > 200) throw bad("originalName must be a string of at most 200 characters");
    out.originalName = originalName.replace(/[\u0000-\u001f]/g, "").split(/[\\/]/).pop();
  }
  if (pages != null) {
    if (!Number.isInteger(pages) || pages < 1 || pages > 10_000) throw bad("pages must be a positive integer");
    out.pages = pages;
  }
  return out;
}
