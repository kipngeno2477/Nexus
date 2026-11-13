import { createLlmClient, llmConfigFromEnv } from "./client.js";

// Singleton configured from env at startup (dotenv must be loaded before importing this).
export const llm = createLlmClient(llmConfigFromEnv());
