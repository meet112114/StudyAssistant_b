
import path from "path";
import { extractTextFromFile } from "./generateEmbeddings.js";
import { chatCompletion } from "./llmProvider.js";

const MAX_TEXT_LENGTH = 15000;

/* ===============================
   SUMMARY
================================= */
export const generateSummaryForResource = async (resourceDoc) => {
  const filePath = path.join(process.cwd(), resourceDoc.url);

  let text = await extractTextFromFile(filePath, resourceDoc.type);

  if (!text || text.trim().length === 0) {
    throw new Error("Could not extract text.");
  }

  const truncatedText = text.slice(0, MAX_TEXT_LENGTH);

  const messages = [
    {
      role: "user",
      content: `You are an educational assistant.
Provide a concise, clear, and comprehensive summary:

${truncatedText}

Summary:`,
    },
  ];

  return chatCompletion(messages, { maxTokens: 500, temperature: 0.5 });
};

/* ===============================
   QUIZ
================================= */
export const generateQuizForResource = async (resourceDoc) => {
  const filePath = path.join(process.cwd(), resourceDoc.url);

  let text = await extractTextFromFile(filePath, resourceDoc.type);

  if (!text || text.trim().length === 0) {
    throw new Error("Could not extract text.");
  }

  const truncatedText = text.slice(0, MAX_TEXT_LENGTH);

  const messages = [
    {
      role: "user",
      content: `You are a JSON API. Your response must be ONLY a valid JSON array — no markdown, no explanations, no code fences, no extra text before or after the array.

Create exactly 10 multiple-choice questions based on the text below.

Each element of the array must follow this exact structure:
{
  "question": "Question text here?",
  "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
  "correctAnswer": "Option A text"
}

Rules:
- "options" must be an array of 4 plain strings (no letter prefixes like "A.", just the text).
- "correctAnswer" must be the exact full string of the correct option.
- Do NOT include any text outside the JSON array.

Text:
${truncatedText}`,
    },
  ];

  let result = await chatCompletion(messages, { maxTokens: 2000, temperature: 0.2, jsonMode: true });

  // Robustly extract the first [...] JSON array from the response,
  // regardless of surrounding prose, markdown fences, or think-tags.
  const arrayMatch = result.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error(`LLM did not return a JSON array. Response: ${result.slice(0, 300)}`);
  }

  const parsed = JSON.parse(arrayMatch[0]);

  // Debug: log the first raw question so key names are visible in the console.
  // Remove this log once the model output is stable.
  console.log("[Quiz] First raw question from LLM:", JSON.stringify(parsed[0], null, 2));

  // All known aliases LLMs use for the correct-answer field.
  const CORRECT_ANSWER_ALIASES = [
    "correctAnswer",   // camelCase  (what we ask for)
    "correct_answer",  // snake_case (Gemma tends to use this)
    "answer",
    "correct",
    "correctOption",
    "correct_option",
    "right_answer",
    "rightAnswer",
  ];

  const normalized = parsed.map((q) => {
    let options = q.options;

    // ── Resolve correctAnswer from any alias ──────────────────────────────────
    let correctAnswer;
    for (const alias of CORRECT_ANSWER_ALIASES) {
      if (q[alias] !== undefined && q[alias] !== null && q[alias] !== "") {
        correctAnswer = q[alias];
        break;
      }
    }

    // ── Normalise options object → array ──────────────────────────────────────
    // Model sometimes returns { A: "...", B: "...", C: "...", D: "..." }
    if (options && !Array.isArray(options) && typeof options === "object") {
      const keys = Object.keys(options);
      options = keys.map((k) => `${k}: ${options[k]}`);

      // If correctAnswer is a single letter like 'A', map it to the full string
      if (correctAnswer && correctAnswer.length === 1) {
        const match = options.find((o) => o.startsWith(`${correctAnswer}:`));
        if (match) correctAnswer = match;
      }
    }

    // ── Normalise array elements to strings ───────────────────────────────────
    if (Array.isArray(options)) {
      options = options.map((o) => {
        if (typeof o === "object" && o !== null) {
          return Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(", ");
        }
        return String(o);
      });
    }

    // ── If correctAnswer is a letter index ('A','B','C','D'), resolve it ──────
    if (correctAnswer && /^[A-Da-d]$/.test(String(correctAnswer).trim())) {
      const letter = correctAnswer.trim().toUpperCase();
      const idx = { A: 0, B: 1, C: 2, D: 3 }[letter];
      if (options[idx] !== undefined) correctAnswer = options[idx];
    }

    // ── Absolute fallback: use first option so required field is never empty ──
    if (!correctAnswer && Array.isArray(options) && options.length > 0) {
      console.warn("[Quiz] Could not resolve correctAnswer for question:", q.question);
      correctAnswer = options[0];
    }

    return { question: q.question, options, correctAnswer };
  });

  return normalized;
};