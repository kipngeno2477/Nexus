import { sessions, SESSION_HEADER } from "../src/sessionStore.js";

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_UPLOADS !== "false"; // on by default

function guard(res) {
  if (ALLOW_PRIVATE) return true;
  res.status(403).json({ message: "Private document uploads are disabled on this deployment." });
  return false;
}

export function listSessionDocuments(req, res) {
  const s = sessions.get(req.get(SESSION_HEADER));
  res.json({
    enabled: ALLOW_PRIVATE,
    active: !!s,
    docs: s?.docs ?? [],
    limits: { maxDocs: sessions.limits.maxDocsPerSession, maxChars: sessions.limits.maxChars, ttlMinutes: Math.round(sessions.limits.ttlMs / 60000) },
  });
}

export function addSessionDocument(req, res) {
  if (!guard(res)) return;
  try {
    const out = sessions.addDocument(req.get(SESSION_HEADER), req.body ?? {});
    res.status(201).json(out);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
}

export function removeSessionDocument(req, res) {
  try {
    res.json(sessions.removeDocument(req.get(SESSION_HEADER), req.params.docId));
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
}
