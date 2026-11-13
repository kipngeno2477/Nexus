// Splits cleaned text into section-aware chunks with stable identifiers.

import { isHeading, isPartHeading } from "./clean.js";

// ~200 words ≈ 270 tokens: small enough that K=4 evidence fits a fast prompt on CPU,
// large enough to keep a subsection and its conditions together.
const DEFAULTS = { maxWords: 200, overlapWords: 40, minWords: 8 };

export function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "untitled";
}

function sectionIdFrom(title, index) {
  const m = title.match(/^(?:section|sec\.|chapter|article|regulation|rule|clause)?\s*([0-9ivxlc]+(?:\.[0-9]+)*[a-z]?)/i);
  return m ? `s${m[1].toLowerCase()}` : `s${index}`;
}

/** Groups lines into sections; text before the first heading becomes "preamble". */
export function splitSections(cleaned) {
  const sections = [];
  let part = null;
  let current = { title: "Preamble", part, lines: [] };
  const flush = () => {
    if (current.lines.join(" ").trim()) sections.push(current);
  };
  for (const line of cleaned.split("\n")) {
    if (isPartHeading(line)) {
      flush();
      part = line;
      current = { title: line, part, lines: [], partIntro: true }; // text directly under a Part heading
    } else if (isHeading(line)) {
      flush();
      current = { title: line, part, lines: [] };
    } else if (line) {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * @param {{docId:string, docTitle:string, sourceFile:string, text:string, sourceUrl?:string}} doc  text already cleaned
 * @returns chunk objects carrying full citation metadata
 */
export function chunkDocument(doc, opts = {}) {
  const { maxWords, overlapWords, minWords } = { ...DEFAULTS, ...opts };
  const chunks = [];
  const usedSectionIds = new Map();

  splitSections(doc.text).forEach((sec, si) => {
    let sectionId =
      sec.title === "Preamble" ? "preamble" : sec.partIntro ? `p-${slug(sec.title).slice(0, 20)}` : sectionIdFrom(sec.title, si);
    const n = usedSectionIds.get(sectionId) ?? 0;
    usedSectionIds.set(sectionId, n + 1);
    if (n > 0) sectionId = `${sectionId}-${n + 1}`; // keep ids unique within a doc

    // One token per word, independent of blank lines; a word that starts a new line carries
    // a leading "\n" so excerpts keep their clause layout.
    const words = sec.lines.flatMap((line, li) =>
      line.split(/\s+/).filter(Boolean).map((w, wi) => (wi === 0 && li > 0 ? `\n${w}` : w))
    );
    const step = Math.max(1, maxWords - overlapWords);
    for (let start = 0, part = 1; start < words.length; start += step, part++) {
      const slice = words.slice(start, start + maxWords);
      if (slice.length < minWords && part > 1) break; // tiny trailing overlap fragment
      chunks.push({
        docId: doc.docId,
        docTitle: doc.docTitle,
        sourceFile: doc.sourceFile,
        ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
        part: sec.part,
        sectionId,
        sectionTitle: sec.title,
        chunkId: `${sectionId}-c${String(part).padStart(2, "0")}`,
        text: slice.join(" ").replace(/ \n/g, "\n").replace(/^\n/, ""),
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
