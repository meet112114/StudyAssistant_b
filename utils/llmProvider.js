
/**
 * llmProvider.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified LLM adapter for Study Assistant backend.
 *
 * Supported providers (set LLM_PROVIDER in .env):
 *   "hf"     → Hugging Face Inference API  (requires HUGGINGFACE_API_KEY)
 *   "openai" → OpenAI API                  (requires OPENAI_API_KEY)
 *   "ollama" → Local Ollama server         (requires Ollama running on localhost)
 *
 * Usage:
 *   import { chatCompletion } from "../utils/llmProvider.js";
 *   const reply = await chatCompletion(messages, { maxTokens, temperature });
 *
 * `messages` must be an array of { role, content } objects (OpenAI format).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ── Provider / Model config ─────────────────────────────────────────────────
   NOTE: All env vars are read INSIDE functions (not at module level) so that
   dotenv.config() in server.js has already run before these values are used.
──────────────────────────────────────────────────────────────────────────── */
const getProvider   = () => (process.env.LLM_PROVIDER  || "hf").trim().toLowerCase();
const getHFModel    = () => (process.env.HF_MODEL      || "google/gemma-3-27b-it").trim();
const getOpenAIModel= () => (process.env.OPENAI_MODEL  || "gpt-4o-mini").trim();
const getOllamaModel= () => (process.env.OLLAMA_MODEL  || "gemma4").trim();
const getOllamaURL  = () => (process.env.OLLAMA_URL    || "http://localhost:11434/api/chat").trim();

// Thinking models (e.g. gemma4) spend extra tokens on chain-of-thought before
// writing the actual response. Multiply num_predict so the thinking phase does
// not exhaust the entire token budget. Override via OLLAMA_TOKEN_MULTIPLIER.
const getOllamaTokenMultiplier = () =>
  parseInt(process.env.OLLAMA_TOKEN_MULTIPLIER || "4", 10);

/* ── Internal helpers ─────────────────────────────────────────────────────── */

/** Hugging Face via @huggingface/inference chatCompletion */
const callHF = async (messages, maxTokens, temperature) => {
  const { HfInference } = await import("@huggingface/inference");
  const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

  const result = await hf.chatCompletion({
    model: getHFModel(),
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  return result.choices[0].message.content.trim();
};

/** OpenAI via the official `openai` npm package */
const callOpenAI = async (messages, maxTokens, temperature) => {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const result = await openai.chat.completions.create({
    model: getOpenAIModel(),
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  return result.choices[0].message.content.trim();
};

/** Ollama local server (/api/chat endpoint) */
const callOllama = async (messages, maxTokens, temperature, jsonMode = false) => {
  // Thinking models (gemma4, etc.) consume tokens on their chain-of-thought
  // BEFORE writing the actual response. Multiply the budget so content isn't empty.
  const effectiveTokens = maxTokens * getOllamaTokenMultiplier();

  const body = {
    model: getOllamaModel(),
    messages,
    stream: false,
    options: {
      temperature,
      num_predict: effectiveTokens,
    },
  };

  // Ollama's native JSON mode — constrains the token sampler to emit only valid
  // JSON, which is more reliable than prompt engineering alone.
  if (jsonMode) body.format = "json";

  const response = await fetch(getOllamaURL(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${text}`);
  }

  const data = await response.json();

  // Prefer the final content; fall back to thinking if the model ran out of
  // tokens before writing a formal response (done_reason === "length").
  const content   = (data.message?.content   || "").trim();
  const thinking  = (data.message?.thinking  || "").trim();

  if (content) return content;

  if (thinking) {
    console.warn(
      `[Ollama] done_reason="${data.done_reason}" — content was empty, ` +
      `using thinking field as response. Consider raising OLLAMA_TOKEN_MULTIPLIER ` +
      `(currently ${getOllamaTokenMultiplier()}) in .env.`
    );
    return thinking;
  }

  console.error("[Ollama] Full raw response:", JSON.stringify(data, null, 2));
  throw new Error(
    `Ollama returned empty content AND empty thinking. Model: "${getOllamaModel()}". ` +
    `Ensure it is pulled and running correctly.`
  );
};

/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * chatCompletion — send a chat to the configured LLM provider.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=500]
 * @param {number} [opts.temperature=0.6]
 * @param {boolean} [opts.jsonMode=false]  Force JSON output (Ollama only for now)
 * @returns {Promise<string>} The assistant's reply text
 */
export const chatCompletion = async (messages, opts = {}) => {
  const { maxTokens = 500, temperature = 0.6, jsonMode = false } = opts;

  // Read env at call-time (dotenv.config() is guaranteed to have run by now)
  const provider = getProvider();

  console.log(`[LLM] Provider: ${provider.toUpperCase()}`);

  switch (provider) {
    case "hf":
      console.log(`[LLM] Model: ${getHFModel()}`);
      return callHF(messages, maxTokens, temperature);

    case "openai":
      console.log(`[LLM] Model: ${getOpenAIModel()}`);
      return callOpenAI(messages, maxTokens, temperature);

    case "ollama":
      console.log(`[LLM] Model: ${getOllamaModel()}`);
      return callOllama(messages, maxTokens, temperature, jsonMode);

    default:
      throw new Error(
        `[LLM] Unknown provider "${provider}". Set LLM_PROVIDER to "hf", "openai", or "ollama" in .env`
      );
  }
};

/** Convenience: get active provider name at call-time */
export const activeProvider = () => getProvider();
