import "dotenv/config"; // must be first: modules below read env at import time
import express from "express";
import cors from "cors";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";
import askRoutes from "./routes/ask.route.js";
import documentRoutes from "./routes/uploadDocumentRoute.route.js";
import sessionRoutes from "./routes/session.route.js";
import { kb } from "./src/kb.js";
import { llm } from "./src/llm/instance.js";

const app = express();
// Behind PrimeCloud / reverse proxy, req.ip must come from X-Forwarded-For for per-client rate limits.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Liveness/readiness probe: accepts /health, /healthz, and /api/healthz (cheap, never calls model)
const handleHealth = (req, res) => {
  const ok = !kb.error && kb.chunks.length > 0;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    ok,
    chunks: kb.chunks.length,
    ...(kb.error ? { error: kb.error } : {}),
  });
};

app.get("/health", handleHealth);
app.get("/healthz", handleHealth);

app.use("/api", askRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/session", sessionRoutes);

// Serve the built frontend (Frontend/dist) from the same origin when it exists.
const DIST = process.env.FRONTEND_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../Frontend/dist");
if (existsSync(path.join(DIST, "index.html"))) {
  app.use(express.static(DIST));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST, "index.html")));
  console.log(`Serving frontend from ${DIST}`);
} else {
  // In API-only mode, return 200 on root so basic probes succeed
  app.get("/", (req, res) => {
    res.json({ name: "nexus-api", status: "ok" });
  });
}

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5000;

try {
  await kb.load();
  console.log(`Knowledge base: ${kb.docs.length} docs, ${kb.chunks.length} chunks`);
} catch (e) {
  console.error(`Knowledge base failed to load: ${e.message}`); // served as retrieval/health errors
}
console.log(`LLM: ${llm.config.provider} ${llm.config.model || "(LLM_MODEL not set)"} @ ${llm.config.baseUrl}`);

// Explicitly bind to 0.0.0.0 so Docker / container proxies can reach the server
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// Zero-downtime deploys stop the old container with SIGTERM: finish in-flight answers, then exit.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} received, closing server`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref(); // safety net
  });
}
