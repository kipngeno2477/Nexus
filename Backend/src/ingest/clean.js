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

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Short lines repeated many times (running headers/footers) are dropped.
function removeRepeatedLines(lines) {
  const counts = new Map();
  for (const l of lines) if (l && l.length < 80) counts.set(l, (counts.get(l) ?? 0) + 1);
  const threshold = Math.max(3, Math.floor(lines.length / 40));
  return lines.filter((l) => !(counts.get(l) >= threshold && !isHeading(l)));
}

export const HEADING_RE =
  /^(?:(?:section|sec\.|part|chapter|article|schedule|regulation|rule|clause)\s+[0-9ivxlc]+[a-z]?\b.*|[0-9]{1,3}(?:\.[0-9]{1,3})*\.?\s+[A-Z][^.]{0,100})$/i;

export function isHeading(line) {
  return line.length <= 120 && HEADING_RE.test(line);
}
