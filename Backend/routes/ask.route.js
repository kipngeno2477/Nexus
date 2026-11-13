import { Router } from "express";
import { ask, health } from "../controllers/ask.controller.js";

const router = Router();

router.post("/ask", ask);
router.get("/health", health);

export default router;
