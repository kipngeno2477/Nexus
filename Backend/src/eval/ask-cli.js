// Ask questions from the terminal through the real pipeline.
// Usage: npm run ask -- "question one" "question two"
import "dotenv/config";
import { kb } from "../kb.js";
import { llm } from "../llm/instance.js";
import { answerQuestion } from "../pipeline/answer.js";
await kb.load();
const qs = process.argv.slice(2);
for (const q of qs) {
  const r = await answerQuestion({ question: q, k: 4 }, { index: kb.index, llm, minScore: Number(process.env.RETRIEVAL_MIN_SCORE ?? 0), minCoverage: Number(process.env.RETRIEVAL_MIN_COVERAGE ?? 0.6) });
  console.log("\nQ:", q);
  console.log("status:", r.status, "| llm ms:", r.debug.llm.ms, "| calls:", r.debug.llm.calls, "| repairs:", r.debug.llm.repairs, "| tokens:", JSON.stringify(r.debug.llm.usage));
  console.log("evidence:", r.evidence.map(e => `${e.ref}=${e.sectionId}`).join(" "));
  for (const a of r.answer) console.log("  -", a.text, a.refs, a.lowOverlap ? "(LOW OVERLAP)" : "");
  if (r.message) console.log("  msg:", r.message);
  for (const w of r.warnings) console.log("  warn:", w.code, "-", w.detail.slice(0, 120));
  for (const u of r.unsupported) console.log("  unsupported:", u.text);
  if (r.debug.llm.errors.length) console.log("  errors:", JSON.stringify(r.debug.llm.errors));
}
