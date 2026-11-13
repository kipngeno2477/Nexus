// Cleans obvious formatting noise from plain-text documents.
// Conservative by design: it removes layout artefacts, never rewrites content.
// cleanTextWithStats() also reports what was changed, for the ingestion report.

const PAGE_NUMBER_RE = /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i;

export function cleanTextWithStats(raw) {
  const stats = { rawChars: 0, rawLines: 0, cleanedLines: 0, pageNumbersRemoved: 0, repeatedLinesRemoved: 0, repeatedLineSamples: [], hyphenationsJoined: 0, controlCharsRemoved: 0, clauseMarkersJoined: 0 };
  let t = String(raw ?? "");
  stats.rawChars = t.length;
  t = t.replace(/^﻿/, "");                       // BOM
  t = t.replace(/\r\n?/g, "\n");                       // line endings
  stats.rawLines = t.split("\n").length;
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, () => (stats.controlCharsRemoved++, ""));
  t = t.replace(/[​-‍ ]/g, (c) => (c === " " ? " " : ""));
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-");
  t = t.replace(/(\w)-\n(\w)/g, (_, a, b) => (stats.hyphenationsJoined++, a + b)); // hyphenated line breaks
  t = t.replace(/[ \t]+/g, " ");

  let lines = t.split("\n").map((l) => l.trim());
  lines = lines.filter((l) => !(PAGE_NUMBER_RE.test(l) && ++stats.pageNumbersRemoved));
  lines = removeRepeatedLines(lines, stats);
  lines = joinClauseMarkers(lines, stats);

  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  stats.cleanedLines = text ? text.split("\n").length : 0;
  return { text, stats };
}

export function cleanText(raw) {
  return cleanTextWithStats(raw).text;
}

// Short lines repeated many times (running headers/footers) are dropped.
function removeRepeatedLines(lines, stats) {
  const counts = new Map();
  for (const l of lines) if (l && l.length < 80 && !CLAUSE_MARKER_RE.test(l)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const threshold = Math.max(3, Math.floor(lines.length / 40));
  return lines.filter((l) => {
    const drop = counts.get(l) >= threshold && !isHeading(l) && !isPartHeading(l);
    if (drop) {
      stats.repeatedLinesRemoved++;
      if (!stats.repeatedLineSamples.includes(l) && stats.repeatedLineSamples.length < 5) stats.repeatedLineSamples.push(l);
    }
    return !drop;
  });
}

// "(a)" alone on a line followed by its text → "(a) text"
const CLAUSE_MARKER_RE = /^\((?:[a-z]{1,2}|[ivx]{1,5}|\d{1,3}[a-z]?)\)$/i;
function joinClauseMarkers(lines, stats) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (CLAUSE_MARKER_RE.test(lines[i])) {
      // skip blank lines left behind by removed page numbers / running headers
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      if (j < lines.length && !isHeading(lines[j]) && !isPartHeading(lines[j]) && !CLAUSE_MARKER_RE.test(lines[j])) {
        out.push(`${lines[i]} ${lines[j]}`);
        stats.clauseMarkersJoined++;
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out;
}

/**
 * Best-effort document title: the first meaningful line of the RAW text (running headers are
 * often the title, and cleaning removes them as noise), else a humanised file name.
 */
export function inferTitle(raw, fileName) {
  const first = String(raw ?? "")
    .replace(/^﻿/, "")
    .split(/\r\n?|\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .find((l) => l && !PAGE_NUMBER_RE.test(l));
  if (first && first.length <= 120 && !isHeading(first) && !isPartHeading(first) && /[a-z]/i.test(first) && first.split(" ").length <= 16)
    return first;
  const base = String(fileName ?? "Untitled").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const KEYWORD_HEADING_RE =
  /^(?:section|sec\.|chapter|article|regulation|rule|clause)\s+[0-9ivxlc]+[a-z]?\b.{0,100}$/i;
const NUMBERED_HEADING_RE = /^[0-9]{1,3}[A-Z]?(?:\.[0-9]{1,3})*\.?\s+[A-Z].{0,110}$/;
const PART_RE = /^(?:part|schedule)\s+(?:[0-9ivxlc]+|[a-z]+)\b.{0,140}$/i;

/** A section heading: "12. Fees", "Section 4 Trading", "3.1 Scope". Short, not a sentence. */
export function isHeading(line) {
  if (!line || line.length > 120) return false;
  if (/[;:,]$/.test(line)) return false;                         // list item / run-on clause
  if (line.split(/\s+/).length > 16) return false;
  if (NUMBERED_HEADING_RE.test(line)) return !/\b(shall|may|must|is|are)\b/.test(line); // not a numbered sentence
  return KEYWORD_HEADING_RE.test(line);
}

/** A grouping heading above sections: "Part II - RIGHT TO INFORMATION", "Schedule 1". */
export function isPartHeading(line) {
  return !!line && line.length <= 160 && PART_RE.test(line);
}
