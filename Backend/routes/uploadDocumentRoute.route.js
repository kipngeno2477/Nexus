import { Router } from "express";
import { listDocuments, listChunks, getChunk, uploadDocument } from "../controllers/uploadDocument.controller.js";

const router = Router();

router.get("/", listDocuments);
router.post("/", uploadDocument);
router.get("/:docId/chunks", listChunks);
router.get("/:docId/chunks/:chunkId", getChunk);

export default router;
