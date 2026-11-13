import { SessionStore } from "./sessions.js";
import { kb, SYNONYMS } from "./kb.js";

export const sessions = new SessionStore({ kb, synonyms: SYNONYMS });

// Periodically drop idle sessions so private documents don't linger in memory.
setInterval(() => sessions.sweep(), 5 * 60 * 1000).unref();

export const SESSION_HEADER = "x-session-id";
