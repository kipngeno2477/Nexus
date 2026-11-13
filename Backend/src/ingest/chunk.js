// Splits cleaned text into section-aware chunks with stable identifiers.

import { isHeading } from "./clean.js";

const DEFAULTS = { maxWords: 300, overlapWords: 40, minWords: 8 };

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "untitled";
}

function sectionIdFrom(title, index) {
  const m = title.match(/^(?:section|sec\.|part|chapter|article|schedule|regulation|rule|clause)?\s*([0-9ivxlc]+(?:\.[0-9]+)*[a-z]?)/i);
  return m ? `s${m[1].toLowerCase()}` : `s${index}`;
}

/** Groups lines into sections; text before the first heading becomes "preamble". */
export function splitSections(cleaned) {
  const sections = [];
  let current = { title: "Preamble", lines: [], start: 0 };
  let offset = 0;
  for (const line of cleaned.split("\n")) {
    if (isHeading(line)) {
      if (current.lines.join(" ").trim()) sections.push(current);
      current = { title: line, lines: [], start: offset };
    } else if (line) {
      current.lines.push(line);
    }
    offset += line.length + 1;
  }
  if (current.lines.join(" ").trim()) sections.push(current);
  return sections;
}

/**
 * @param {{docId:string, docTitle:string, sourceFile:string, text:string}} doc  text already cleaned
 * @returns chunk objects carrying full citation metadata
 */
export function chunkDocument(doc, opts = {}) {
  const { maxWords, overlapWords, minWords } = { ...DEFAULTS, ...opts };
  const chunks = [];
  const usedSectionIds = new Map();

  splitSections(doc.text).forEach((sec, si) => {
    let sectionId = sec.title === "Preamble" ? "preamble" : sectionIdFrom(sec.title, si);
    const n = usedSectionIds.get(sectionId) ?? 0;
    usedSectionIds.set(sectionId, n + 1);
    if (n > 0) sectionId = `${sectionId}-${n + 1}`; // keep ids unique within a doc

    const words = sec.lines.join(" ").split(/\s+/).filter(Boolean);
    const step = Math.max(1, maxWords - overlapWords);
    for (let start = 0, part = 1; start < words.length; start += step, part++) {
      const slice = words.slice(start, start + maxWords);
      if (slice.length < minWords && part > 1) break; // tiny trailing overlap fragment
      chunks.push({
        docId: doc.docId,
        docTitle: doc.docTitle,
        sourceFile: doc.sourceFile,
        sectionId,
        sectionTitle: sec.title,
        chunkId: `${sectionId}-c${String(part).padStart(2, "0")}`,
        text: slice.join(" "),
        wordStart: start,
      });
      if (start + maxWords >= words.length) break;
    }
  });
  return chunks;
}

export function docIdFromFilename(name) {
  return slug(name.replace(/\.[^.]+$/, ""));
}
