import { Router } from "express";
import { listSessionDocuments, addSessionDocument, removeSessionDocument } from "../controllers/session.controller.js";

// Private, per-browser documents (header: x-session-id). Never shared, never written to disk.
const router = Router();

router.get("/documents", listSessionDocuments);
router.post("/documents", addSessionDocument);
router.delete("/documents/:docId", removeSessionDocument);

export default router;
