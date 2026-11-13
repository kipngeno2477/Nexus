// Thin LLM adapter. Providers are configured explicitly via env — nothing defaults
// to a hosted service. Every call has a timeout and a capped output size.
//
//   LLM_PROVIDER = ollama | openai_compatible
//   LLM_BASE_URL   e.g. http://localhost:11434  or  https://<approved-endpoint>/v1
//   LLM_MODEL      e.g. qwen2.5:3b
//   LLM_API_KEY    (openai_compatible only; server-side secret)
//   LLM_FALLBACK_MODEL     (openai_compatible) tried once if the primary model fails
//   LLM_REASONING_EFFORT   (openai_compatible) sent only to the primary model, e.g. "none"

export class LlmError extends Error {
  /** kind: timeout | unavailable | rate_limited | http | bad_response | not_configured */
  constructor(kind, message, { retryable = false, status } = {}) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.retryable = retryable;
    this.status = status;
  }
}

export function llmConfigFromEnv(env = process.env) {
  return {
    provider: env.LLM_PROVIDER || "ollama",
    baseUrl: (env.LLM_BASE_URL || "http://localhost:11434").replace(/\/+$/, ""),
    model: env.LLM_MODEL || "",
    apiKey: env.LLM_API_KEY || "",
    timeoutMs: Number(env.LLM_TIMEOUT_MS) || 60000,
    maxTokens: Number(env.LLM_MAX_TOKENS) || 600,
    numCtx: Number(env.LLM_NUM_CTX) || 8192,
    keepAlive: env.LLM_KEEP_ALIVE || "30m",
    fallbackModel: env.LLM_FALLBACK_MODEL || "",
    reasoningEffort: env.LLM_REASONING_EFFORT || "", // e.g. "none" for qwen/qwen3.8-27b on Groq
  };
}

async function postJson(url, body, { headers = {}, timeoutMs }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new LlmError("timeout", `LLM timed out after ${timeoutMs} ms`, { retryable: true });
    throw new LlmError("unavailable", `LLM endpoint unreachable: ${e.cause?.code || e.message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (res.status === 429) throw new LlmError("rate_limited", "LLM rate limited", { retryable: true, status: 429 });
  if (res.status >= 500) throw new LlmError("http", `LLM server error ${res.status}`, { retryable: true, status: res.status });
  if (!res.ok) throw new LlmError("http", `LLM request failed ${res.status}: ${text.slice(0, 200)}`, { status: res.status });
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError("bad_response", "LLM returned non-JSON HTTP body");
  }
}

/**
 * @returns {{ chat(messages, {schema}): Promise<{content:string, model:string, usage?:object}>, health(): Promise<object>, config }}
 */
export function createLlmClient(config = llmConfigFromEnv()) {
  const { provider, baseUrl, model, apiKey, timeoutMs, maxTokens, numCtx } = config;

  function ensureConfigured() {
    if (!model) throw new LlmError("not_configured", "LLM_MODEL is not set");
  }

  if (provider === "ollama") {
    return {
      config: { provider, baseUrl, model },
      async chat(messages, { schema } = {}) {
        ensureConfigured();
        const data = await postJson(
          `${baseUrl}/api/chat`,
          {
            model,
            messages,
            stream: false,
            format: schema ?? "json",
            options: { temperature: 0, num_predict: maxTokens, num_ctx: numCtx },
            keep_alive: config.keepAlive, // avoid reloading the model between questions
          },
          { timeoutMs }
        );
        if (data.error) throw new LlmError("http", `Ollama error: ${data.error}`);
        const content = data.message?.content;
        if (typeof content !== "string") throw new LlmError("bad_response", "Ollama response missing message.content");
        return { content, model: data.model, usage: { prompt: data.prompt_eval_count, output: data.eval_count } };
      },
      async health() {
        const ac = AbortSignal.timeout(3000);
        try {
          const res = await fetch(`${baseUrl}/api/tags`, { signal: ac });
          const tags = await res.json();
          const installed = (tags.models ?? []).map((m) => m.name);
          return { ok: !!model && installed.some((n) => n === model || n === `${model}:latest`), provider, model, installed };
        } catch (e) {
          return { ok: false, provider, model, error: e.message };
        }
      },
    };
  }

  if (provider === "openai_compatible") {
    const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    const { fallbackModel, reasoningEffort } = config;

    async function complete(modelId, messages, schema, extra) {
      const base = { model: modelId, messages, temperature: 0, max_tokens: maxTokens, ...extra };
      const call = (response_format) => postJson(`${baseUrl}/chat/completions`, { ...base, response_format }, { headers, timeoutMs });
      let data;
      try {
        data = await call(
          schema ? { type: "json_schema", json_schema: { name: "answer", schema, strict: false } } : { type: "json_object" }
        );
      } catch (e) {
        // Model without structured-output support: downgrade once to plain JSON mode
        // (the prompt already spells out the JSON shape; verify.js validates it).
        if (!(schema && e.status === 400 && /response_format|json_schema/i.test(e.message))) throw e;
        data = await call({ type: "json_object" });
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new LlmError("bad_response", "Response missing choices[0].message.content");
      return { content, model: data.model ?? modelId, usage: data.usage };
    }

    return {
      config: { provider, baseUrl, model, fallbackModel: fallbackModel || null },
      /**
       * Primary model first; if it fails (outage, rate limit, model withdrawn) and a fallback
       * is configured, the fallback is tried exactly once. Bounded: at most 2 model calls
       * (+1 JSON-mode downgrade each) per pipeline attempt.
       */
      async chat(messages, { schema } = {}) {
        ensureConfigured();
        try {
          return await complete(model, messages, schema, reasoningEffort ? { reasoning_effort: reasoningEffort } : {});
        } catch (e) {
          const fallbackWorthy = e.retryable || e.status === 404 || (e.status === 400 && /model/i.test(e.message));
          if (!fallbackModel || !fallbackWorthy) throw e;
          const out = await complete(fallbackModel, messages, schema, {});
          return { ...out, fallbackFrom: { model, error: e.message } };
        }
      },
      async health() {
        return { ok: !!model && !!baseUrl && !!apiKey, provider, model, fallbackModel: fallbackModel || null, apiKeySet: !!apiKey, note: "not probed to save quota" };
      },
    };
  }

  throw new LlmError("not_configured", `Unknown LLM_PROVIDER "${provider}"`);
}
