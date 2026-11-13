import { Router } from "express";
import { listDocuments, listChunks, getChunk, uploadDocument, deleteDocument } from "../controllers/uploadDocument.controller.js";

const router = Router();

router.get("/", listDocuments);
router.post("/", uploadDocument);
router.delete("/:docId", deleteDocument);
router.get("/:docId/chunks", listChunks);
router.get("/:docId/chunks/:chunkId", getChunk);

export default router;
