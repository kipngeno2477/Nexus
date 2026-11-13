// Prompt + output schema for grounded, cited synthesis.
// Evidence is tagged E1..EK (short tags are far more reliable for small models than long ids);
// tags are mapped back to full document/section/chunk citations after generation.

export const VERDICTS = ["answered", "insufficient_evidence", "conflicting_evidence"];

export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: VERDICTS },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["text", "evidence"],
      },
    },
    missing: { type: "string" },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["description", "evidence"],
      },
    },
  },
  required: ["verdict", "claims", "missing", "conflicts"],
};

const SYSTEM = `You answer citizens' questions about laws and public-service documents.
Use ONLY the numbered evidence passages provided. Never use outside knowledge.

Rules:
1. Break the answer into short claims in plain language. Every claim must list the evidence tags (e.g. "E2") that directly support it.
2. Do not state anything the evidence does not say. No guesses, no general advice.
   Include every fact in the evidence that answers the question: amounts, fees, time limits, who decides, conditions and exceptions. Quote numbers exactly as written.
3. If the evidence does not answer the question, set verdict "insufficient_evidence", return no claims, and explain in "missing" what information is absent.
4. If the evidence covers only part of the question, answer that part and describe the uncovered part in "missing".
5. If passages contradict each other on the question, set verdict "conflicting_evidence" and describe each conflict with its tags.
6. At most 6 claims. Respond with JSON only, matching:
{"verdict": "answered" | "insufficient_evidence" | "conflicting_evidence",
 "claims": [{"text": "...", "evidence": ["E1"]}],
 "missing": "",
 "conflicts": [{"description": "...", "evidence": ["E1", "E2"]}]}`;

export function evidenceTag(i) {
  return `E${i + 1}`;
}

export function formatEvidence(chunks) {
  return chunks
    .map((c, i) => {
      const where = [c.docTitle, c.part, c.sectionTitle].filter(Boolean).join(" > ");
      return `[${evidenceTag(i)}] ${where}\n${c.text}`;
    })
    .join("\n\n");
}

export function buildMessages(question, chunks) {
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `EVIDENCE:\n\n${formatEvidence(chunks)}\n\nQUESTION: ${question}` },
  ];
}

export function buildRepairMessages(question, chunks, badOutput, problem) {
  return [
    ...buildMessages(question, chunks),
    { role: "assistant", content: String(badOutput).slice(0, 2000) },
    {
      role: "user",
      content: `Your previous reply was invalid (${problem}). Reply again with ONLY valid JSON in the required format, using only tags E1-E${chunks.length}.`,
    },
  ];
}
