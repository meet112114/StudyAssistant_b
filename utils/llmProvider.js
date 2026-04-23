// Ollama is onlyfor locla use ( localhost ) , not for production
// Use hf or openai in prod , and accesstoken and key to env 

const getProvider = () =>
  (process.env.LLM_PROVIDER || "hf").trim().toLowerCase();
const getHFModel = () =>
  (process.env.HF_MODEL || "google/gemma-3-27b-it").trim();
const getOpenAIModel = () => (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
const getOllamaModel = () => (process.env.OLLAMA_MODEL || "gemma4").trim();
const getOllamaURL = () =>
  (process.env.OLLAMA_URL || "http://localhost:11434/api/chat").trim();
const getOllamaTokenMultiplier = () =>
  parseInt(process.env.OLLAMA_TOKEN_MULTIPLIER || "4", 10);

export const CREDIT_RATE = {
  USD_TO_INR: 93,
  ACCOUNT_OVERHEAD: 1.2, 
  PROFIT_MARGIN: 0.4, 

  PROVIDERS: {
    openai: {
      INPUT_COST_PER_TOKEN_USD: 0.00000015,
      OUTPUT_COST_PER_TOKEN_USD: 0.0000006,
    },
    hf: {
      INPUT_COST_PER_TOKEN_USD: 0.0000001,
      OUTPUT_COST_PER_TOKEN_USD: 0.0000001,
    },
    ollama: {
      INPUT_COST_PER_TOKEN_USD: 0.00000015,
      OUTPUT_COST_PER_TOKEN_USD: 0.0000006,
    },
  },
};

/**
 * calculateCreditsUsed — converts token usage to integer credits.
 * Returns 0 for providers with no cost (ollama).
 *
 * @param {string} provider
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {{ creditsUsed: number, totalCostRs: number }}
 */
export const calculateCreditsUsed = (provider, inputTokens, outputTokens) => {
  const providerRates = CREDIT_RATE.PROVIDERS[provider];

  // Free provider (ollama) — skip deduction
  if (!providerRates) return { creditsUsed: 0, totalCostRs: 0 };

  const { USD_TO_INR, ACCOUNT_OVERHEAD, PROFIT_MARGIN } = CREDIT_RATE;
  const { INPUT_COST_PER_TOKEN_USD, OUTPUT_COST_PER_TOKEN_USD } = providerRates;

  const multiplier = ACCOUNT_OVERHEAD * (1 + PROFIT_MARGIN); // e.g. 1.2 × 1.4 = 1.68

  const inputCostRs =
    inputTokens * INPUT_COST_PER_TOKEN_USD * USD_TO_INR * multiplier;
  const outputCostRs =
    outputTokens * OUTPUT_COST_PER_TOKEN_USD * USD_TO_INR * multiplier;
  const totalCostRs = inputCostRs + outputCostRs;

  // 1 Rs = 500 credits  →  multiply by 500, always round up
  const creditsUsed = Math.ceil(totalCostRs * 500);

  return { creditsUsed, totalCostRs: +totalCostRs.toFixed(6) };
};

/* ── Internal helpers ─────────────────────────────────────────────────────── */

const callHF = async (messages, maxTokens, temperature) => {
  const { HfInference } = await import("@huggingface/inference");
  const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

  const result = await hf.chatCompletion({
    model: getHFModel(),
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  let inputTokens = result.usage?.prompt_tokens || 0;
  if (!inputTokens) {
    const promptString = messages.map(m => m.content).join(" ");
    inputTokens = Math.ceil(promptString.length / 4);
  }

  const content = result.choices[0].message.content || "";
  let outputTokens = result.usage?.completion_tokens || 0;
  if (!outputTokens) {
    outputTokens = Math.ceil(content.length / 4);
  }

  const usage = { inputTokens, outputTokens };
  console.log("[HF] Input tokens: ", usage.inputTokens, "(estimated if no usage object)");
  console.log("[HF] Output tokens: ", usage.outputTokens, "(estimated if no usage object)");

  return {
    content: content.trim(),
    usage,
  };
};

const callOpenAI = async (messages, maxTokens, temperature) => {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const result = await openai.chat.completions.create({
    model: getOpenAIModel(),
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  return {
    content: result.choices[0].message.content.trim(),
    usage: {
      inputTokens: result.usage?.prompt_tokens || 0,
      outputTokens: result.usage?.completion_tokens || 0,
    },
  };
  
  console.log("Input token : ", usage.inputTokens);
  console.log("Output token : ", usage.outputTokens);
};

const callOllama = async (
  messages,
  maxTokens,
  temperature,
  format = false,
) => {
  const effectiveTokens = maxTokens * getOllamaTokenMultiplier();

  const body = {
    model: getOllamaModel(),
    messages,
    stream: false,
    options: { temperature, num_predict: effectiveTokens },
  };

  // format can be: false (none), true/"json" (freeform JSON), or a schema object (structured output)
  if (format && typeof format === "object") {
    body.format = format; // Pass JSON schema directly to Ollama
  } else if (format) {
    body.format = "json";
  }

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
  const content = (data.message?.content || "").trim();
  const thinking = (data.message?.thinking || "").trim();
  const usage = {
    inputTokens: data.prompt_eval_count || 0,
    outputTokens: data.eval_count || 0,
  };

  console.log("Input token : ", usage.inputTokens);
  console.log("Output token : ", usage.outputTokens);
  if (content) return { content, usage };

  if (thinking) {
    console.warn(
      `[Ollama] done_reason="${data.done_reason}" — content was empty, ` +
        `using thinking field as response. Consider raising OLLAMA_TOKEN_MULTIPLIER ` +
        `(currently ${getOllamaTokenMultiplier()}) in .env.`,
    );
    return { content: thinking, usage };
  }

  console.error("[Ollama] Full raw response:", JSON.stringify(data, null, 2));
  throw new Error(
    `Ollama returned empty content AND empty thinking. Model: "${getOllamaModel()}". ` +
      `Ensure it is pulled and running correctly.`,
  );
};

/* ── Post-call bookkeeping (fire-and-forget) ──────────────────────────────── */

const updateUserStats = async (userId, provider, usage) => {
  try {
    const { default: User } = await import("../models/Users.js");

    // 1. Always update raw token counters
    await User.updateOne(
      { _id: userId },
      {
        $inc: {
          "aiUsage.inputTokens": usage.inputTokens || 0,
          "aiUsage.outputTokens": usage.outputTokens || 0,
        },
      },
    );

    // 2. Deduct credits only for paid providers
    const { creditsUsed, totalCostRs } = calculateCreditsUsed(
      provider,
      usage.inputTokens,
      usage.outputTokens,
    );

    if (creditsUsed > 0) {
      const user = await User.findById(userId);
      if (user) {
        // We now deduct even if it brings the balance into negative.
        // This ensures the transaction is recorded and the pre-check blocks them next time.
        await user.deductCredits(
          creditsUsed,
          totalCostRs,
          `${provider.toUpperCase()} · ${usage.inputTokens}in / ${usage.outputTokens}out tokens`,
        );
      }
    }
  } catch (err) {
    // Never crash the main response due to bookkeeping failure
    console.error("[LLM] updateUserStats failed:", err.message);
  }
};

/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * chatCompletion — send a chat to the configured LLM provider.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [opts]
 * @param {number}        [opts.maxTokens=500]
 * @param {number}        [opts.temperature=0.6]
 * @param {boolean|object} [opts.format=false]  — true for freeform JSON, or a JSON schema object for structured output
 * @param {string}        [opts.userId]         — if provided, deducts credits + updates usage
 * @returns {Promise<string>}
 */
export const chatCompletion = async (messages, opts = {}) => {
  const { maxTokens = 500, temperature = 0.6, format = false, userId } = opts;

  const provider = getProvider();
  console.log(`[LLM] Provider: ${provider.toUpperCase()}`);

  // PRE-CHECK: Block generation if user has no credits (except for free providers)
  if (userId && provider !== "ollama") {
    try {
      const { default: User } = await import("../models/Users.js");
      const user = await User.findById(userId);
      if (user && user.credits.balance <= 0) {
        throw new Error("Insufficient credits. Please recharge your account.");
      }
    } catch (err) {
      if (err.message.includes("Insufficient credits")) {
        throw err; // Actually abort the LLM request
      }
      console.error("[LLM] Pre-check failed:", err.message);
    }
  }

  let result;
  switch (provider) {
    case "hf":
      console.log(`[LLM] Model: ${getHFModel()}`);
      result = await callHF(messages, maxTokens, temperature);
      break;

    case "openai":
      console.log(`[LLM] Model: ${getOpenAIModel()}`);
      result = await callOpenAI(messages, maxTokens, temperature);
      break;

    case "ollama":
      console.log(`[LLM] Model: ${getOllamaModel()}`);
      result = await callOllama(messages, maxTokens, temperature, format);
      break;

    default:
      throw new Error(
        `[LLM] Unknown provider "${provider}". Set LLM_PROVIDER to "hf", "openai", or "ollama" in .env`,
      );
  }

  // Fire-and-forget — don't await so the response isn't delayed
  if (userId && result.usage) {
    updateUserStats(userId, provider, result.usage);
  }

  return result.content;
};

/** Convenience: get active provider name at call-time */
export const activeProvider = () => getProvider();
