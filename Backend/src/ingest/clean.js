// Cleans obvious formatting noise from plain-text documents.
// Conservative by design: it removes layout artefacts, never rewrites content.

export function cleanText(raw) {
  let t = String(raw ?? "");
  t = t.replace(/^﻿/, "");                       // BOM
  t = t.replace(/\r\n?/g, "\n");                       // line endings
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""); // control chars
  t = t.replace(/[​-‍ ]/g, (c) => (c === " " ? " " : ""));
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-");
  t = t.replace(/(\w)-\n(\w)/g, "$1$2");                // hyphenated line breaks
  t = t.replace(/[ \t]+/g, " ");

  let lines = t.split("\n").map((l) => l.trim());
  lines = lines.filter((l) => !/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l)); // page numbers
  lines = removeRepeatedLines(lines);
  lines = joinClauseMarkers(lines);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Short lines repeated many times (running headers/footers) are dropped.
function removeRepeatedLines(lines) {
  const counts = new Map();
  for (const l of lines) if (l && l.length < 80 && !CLAUSE_MARKER_RE.test(l)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const threshold = Math.max(3, Math.floor(lines.length / 40));
  return lines.filter((l) => !(counts.get(l) >= threshold && !isHeading(l) && !isPartHeading(l)));
}

// "(a)" alone on a line followed by its text → "(a) text"
const CLAUSE_MARKER_RE = /^\((?:[a-z]{1,2}|[ivx]{1,5}|\d{1,3}[a-z]?)\)$/i;
function joinClauseMarkers(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (CLAUSE_MARKER_RE.test(lines[i]) && i + 1 < lines.length && lines[i + 1] && !isHeading(lines[i + 1])) {
      out.push(`${lines[i]} ${lines[i + 1]}`);
      i++;
    } else out.push(lines[i]);
  }
  return out;
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
