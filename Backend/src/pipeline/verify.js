// Parses and verifies model output against the evidence actually supplied.
// Citations the model invents are removed; claims left without valid support are
// reported as unsupported and excluded from the answer.

import { VERDICTS, evidenceTag } from "./prompt.js";
import { tokenize } from "../retrieval/bm25.js";

const MAX_CLAIMS = 8;
const MAX_CLAIM_CHARS = 500;
const LOW_OVERLAP = 0.35;

export class OutputFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "OutputFormatError";
  }
}

/** Strict-enough parse: JSON object with a known verdict and array fields. Throws OutputFormatError. */
export function parseModelOutput(content) {
  let obj;
  const s = String(content ?? "").trim();
  try {
    obj = JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/); // tolerate stray prose around a JSON object
    if (!m) throw new OutputFormatError("not JSON");
    try {
      obj = JSON.parse(m[0]);
    } catch {
      throw new OutputFormatError("not JSON");
    }
  }
  if (!obj || typeof obj !== "object") throw new OutputFormatError("not an object");
  if (!Array.isArray(obj.claims ?? [])) throw new OutputFormatError("claims is not an array");
  let verdict = obj.verdict;
  let verdictInferred = false;
  if (verdict == null) {
    // Some models omit the field while the rest is fine: infer it from the content.
    verdict = Array.isArray(obj.conflicts) && obj.conflicts.length ? "conflicting_evidence" : (obj.claims ?? []).length ? "answered" : "insufficient_evidence";
    verdictInferred = true;
  } else if (!VERDICTS.includes(verdict)) throw new OutputFormatError(`unknown verdict ${JSON.stringify(verdict)}`);
  return {
    verdict,
    verdictInferred,
    claims: (obj.claims ?? []).filter((c) => c && typeof c.text === "string" && c.text.trim()),
    missing: typeof obj.missing === "string" ? obj.missing.trim() : "",
    conflicts: Array.isArray(obj.conflicts) ? obj.conflicts.filter((c) => c && typeof c.description === "string") : [],
  };
}

function normaliseTags(list, validTags) {
  const out = [];
  const invented = [];
  for (const raw of Array.isArray(list) ? list : []) {
    // Accept "E1", "[E1]", "E1:", "E1.2" / "E1(2)" (sub-clause of passage E1) → E1.
    // Anything that does not resolve to a supplied passage tag is treated as invented.
    const m = String(raw).trim().toUpperCase().match(/^\[?E\s*(\d+)(?:[.:()\s\]].*)?$/);
    const tag = m ? `E${Number(m[1])}` : null;
    if (tag && validTags.has(tag)) {
      if (!out.includes(tag)) out.push(tag);
    } else invented.push(String(raw));
  }
  return { tags: out, invented };
}

// Numbers must come from the source: "21", "twenty-one", "500,000", "five hundred thousand"...
const NUMBER_WORDS = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million".split(" ");
const NUM_RE = new RegExp(`\\b(?:\\d[\\d,.]*|(?:${NUMBER_WORDS.join("|")})(?:[- ](?:${NUMBER_WORDS.join("|")}))*)\\b`, "gi");
export function numbersNotInSource(claimText, supportText) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); // "(1)", "500,000", "twenty-one" all normalise
  const support = ` ${norm(supportText)} `;
  const found = String(claimText).match(NUM_RE) ?? [];
  return [...new Set(found.map(norm))].filter((n) => !support.includes(` ${n} `) && !support.includes(` ${n}`));
}

function overlap(claimText, supportText) {
  const claim = new Set(tokenize(claimText));
  if (claim.size === 0) return 1;
  const support = new Set(tokenize(supportText));
  let hit = 0;
  for (const t of claim) if (support.has(t)) hit++;
  return hit / claim.size;
}

/**
 * @param parsed   output of parseModelOutput
 * @param chunks   the selected evidence chunks, in tag order (E1 = chunks[0])
 */
export function verifyCitations(parsed, chunks) {
  const tagToChunk = new Map(chunks.map((c, i) => [evidenceTag(i), c]));
  const validTags = new Set(tagToChunk.keys());
  const warnings = [];
  const unsupported = [];
  const claims = [];

  for (const c of parsed.claims.slice(0, MAX_CLAIMS)) {
    const text = c.text.trim().slice(0, MAX_CLAIM_CHARS);
    const { tags, invented } = normaliseTags(c.evidence, validTags);
    if (invented.length) warnings.push({ code: "invented_citation_removed", detail: `Removed citations not in evidence: ${invented.join(", ")}`, claim: text });
    if (tags.length === 0) {
      unsupported.push({ text, reason: "no valid citation" });
      continue;
    }
    const support = tags.map((t) => tagToChunk.get(t).text).join(" ");
    const ratio = overlap(text, support);
    const claim = { text, tags, overlap: +ratio.toFixed(2) };
    // Numbers must come from the evidence. If a number is in another selected passage,
    // complete the citation; if it is in none, flag the claim.
    for (const n of numbersNotInSource(text, support)) {
      const home = [...tagToChunk.entries()].find(([t, c]) => !claim.tags.includes(t) && numbersNotInSource(n, c.text).length === 0);
      if (home) {
        claim.tags.push(home[0]);
        warnings.push({ code: "citation_completed", detail: `"${n}" comes from passage ${home[0].slice(1)}, which was added to the claim's citations.`, claim: text });
      } else {
        claim.lowOverlap = true;
        warnings.push({ code: "number_not_in_source", detail: `"${n}" does not appear in any retrieved passage. Check the excerpt.`, claim: text });
      }
    }
    if (ratio < LOW_OVERLAP) {
      claim.lowOverlap = true;
      warnings.push({ code: "low_overlap", detail: "Claim wording differs strongly from its cited passage; check the excerpt.", claim: text });
    }
    claims.push(claim);
  }
  if (parsed.claims.length > MAX_CLAIMS) warnings.push({ code: "claims_truncated", detail: `Only the first ${MAX_CLAIMS} claims kept` });

  const conflicts = parsed.conflicts
    .map((c) => ({ description: c.description.trim().slice(0, MAX_CLAIM_CHARS), tags: normaliseTags(c.evidence, validTags).tags }))
    .filter((c) => c.tags.length > 0);

  let verdict = parsed.verdict;
  if (verdict === "answered" && claims.length === 0) {
    verdict = "insufficient_evidence";
    warnings.push({ code: "no_supported_claims", detail: "Model answered but no claim had valid supporting evidence." });
  }
  if (verdict === "conflicting_evidence" && conflicts.length === 0) {
    warnings.push({ code: "conflict_without_evidence", detail: "Model reported a conflict without citing passages." });
    verdict = claims.length ? "answered" : "insufficient_evidence";
  }
  if (verdict === "insufficient_evidence" && claims.length) {
    // partial answers are fine to show, but keep the abstention status
    warnings.push({ code: "partial_answer", detail: "Evidence covers only part of the question." });
  }

  if (parsed.verdictInferred) warnings.push({ code: "verdict_inferred", detail: `Model omitted the verdict; inferred "${parsed.verdict}" from its content.` });
  return { verdict, claims, unsupported, conflicts, missing: parsed.missing, warnings };
}
