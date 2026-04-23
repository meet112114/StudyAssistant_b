
import path from "path";
import { extractTextFromFile } from "./generateEmbeddings.js";
import { chatCompletion } from "./llmProvider.js";

const MAX_TEXT_LENGTH = 15000;

const safeParseJsonArray = (raw) => {
  console.log("[Quiz] Raw LLM output (first 500 chars):", raw.slice(0, 500));

  // 1. Strip markdown code fences
  let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

  // 2. Remove trailing commas before ] or } (LLMs love these)
  cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

  // 3. Try to find and parse a top-level JSON array first
  const arrStart = cleaned.indexOf("[");
  if (arrStart !== -1) {
    let arrEnd = cleaned.lastIndexOf("]");
    let arrStr = arrEnd > arrStart
      ? cleaned.slice(arrStart, arrEnd + 1)
      : cleaned.slice(arrStart) + "]";

    arrStr = arrStr.replace(/,\s*([}\]])/g, "$1");

    try {
      const result = JSON.parse(arrStr);
      if (Array.isArray(result)) return result;
    } catch { /* fall through */ }

    // Progressive trim — remove incomplete last element up to 15 times
    let attempt = arrStr;
    for (let i = 0; i < 15; i++) {
      const cut = attempt.lastIndexOf("},");
      if (cut <= 0) break;
      attempt = attempt.slice(0, cut + 1) + "]";
      try {
        const result = JSON.parse(attempt);
        if (Array.isArray(result) && result.length > 0) {
          console.warn(`[Quiz] Recovered array by trimming ${i + 1} element(s). Got ${result.length} items.`);
          return result;
        }
      } catch { /* keep trimming */ }
    }
  }

  const objStart = cleaned.indexOf("{");
  if (objStart !== -1) {
    let objEnd = cleaned.lastIndexOf("}");
    let objStr = objEnd > objStart
      ? cleaned.slice(objStart, objEnd + 1)
      : cleaned.slice(objStart) + "}";

    objStr = objStr.replace(/,\s*([}\]])/g, "$1");

    const tryParseObj = (str) => {
      const parsed = JSON.parse(str);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

      // (a) Single question object — wrap in array
      if (parsed.question && (parsed.options || parsed.correctAnswer)) {
        console.warn("[Quiz] Model returned a single question object — wrapping in array.");
        return [parsed];
      }

      // (b) Keyed dict where values are question objects
      const values = Object.values(parsed);
      if (values.length > 0 && values.every(v => v && typeof v === "object" && !Array.isArray(v))) {
        console.warn(`[Quiz] Model returned a keyed object — converted ${values.length} values to array.`);
        return values;
      }

      return null;
    };

    // Try full object first
    try {
      const result = tryParseObj(objStr);
      if (result) return result;
    } catch { /* fall through */ }

    // Progressive trim — remove last key:value pair up to 15 times
    let attempt = objStr;
    for (let i = 0; i < 15; i++) {
      const cut = attempt.lastIndexOf("},");
      if (cut <= 0) break;
      attempt = attempt.slice(0, cut + 1) + "}";
      try {
        const result = tryParseObj(attempt);
        if (result) {
          console.warn(`[Quiz] Recovered object by trimming ${i + 1} pair(s). Got ${result.length} items.`);
          return result;
        }
      } catch { /* keep trimming */ }
    }
  }

  throw new Error(`safeParseJsonArray: Could not extract valid JSON. Raw (first 400 chars): ${raw.slice(0, 400)}`);
};



export const generateSummaryForResource = async (resourceDoc) => {
  let targetPath = resourceDoc.url;
  if (!targetPath.startsWith("http://") && !targetPath.startsWith("https://")) {
    targetPath = path.join(process.cwd(), targetPath);
  }

  let text = await extractTextFromFile(targetPath, resourceDoc.type);

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

  return chatCompletion(messages, { maxTokens: 500, temperature: 0.5, userId: resourceDoc.user });
};

/* ===============================
   QUIZ
================================= */
export const generateQuizForResource = async (resourceDoc, difficulty = 'medium', numQuestions = 10) => {
  let targetPath = resourceDoc.url;
  if (!targetPath.startsWith("http://") && !targetPath.startsWith("https://")) {
    targetPath = path.join(process.cwd(), targetPath);
  }

  let text = await extractTextFromFile(targetPath, resourceDoc.type);

  if (!text || text.trim().length === 0) {
    throw new Error("Could not extract text.");
  }

  const truncatedText = text.slice(0, MAX_TEXT_LENGTH);

  const quizSchema = {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            options: {
              type: "array",
              items: { type: "string" },
            },
            correctAnswer: { type: "string" },
          },
          required: ["question", "options", "correctAnswer"],
        },
      },
    },
    required: ["questions"],
  };

  const messages = [
    {
      role: "user",
      content: `Create exactly ${numQuestions} multiple-choice questions based on the following text.\n\nEach question must have:\n- \"question\": the question text\n- \"options\": exactly 4 answer choices as strings\n- \"correctAnswer\": the exact text of the correct option\n- The overall quiz difficulty should be: ${difficulty}\n\nText:\n${truncatedText}`,
    },
  ];

  const result = await chatCompletion(messages, {
    maxTokens: 3000,
    temperature: 0.2,
    format: quizSchema,
    userId: resourceDoc.user,
  });

  // Parse the structured response
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    // Fallback: try safeParseJsonArray if direct parse fails
    console.warn("[Quiz] Direct JSON.parse failed, trying safeParseJsonArray...");
    parsed = safeParseJsonArray(result);
  }

  // Handle both { questions: [...] } wrapper and bare array [...]
  let questions = Array.isArray(parsed) ? parsed : parsed?.questions;
  if (!Array.isArray(questions)) {
    // Last resort: if it's a single question object, wrap it
    if (parsed?.question && parsed?.options) {
      questions = [parsed];
    } else {
      throw new Error(`Unexpected quiz response shape: ${JSON.stringify(parsed).slice(0, 300)}`);
    }
  }

  console.log(`[Quiz] Got ${questions.length} questions from LLM`);
  console.log("[Quiz] First question:", JSON.stringify(questions[0], null, 2));

  // Light normalization — handle correctAnswer aliases
  const CORRECT_ANSWER_ALIASES = [
    "correctAnswer", "correct_answer", "answer", "correct",
    "correctOption", "correct_option", "right_answer", "rightAnswer",
  ];

  const normalized = questions.map((q) => {
    if (!q || typeof q !== "object") return null;

    const questionText = q.question || q.Question || q.text || "";
    if (!questionText) return null;

    let options = Array.isArray(q.options) ? q.options.map(String) : [];

    let correctAnswer;
    for (const alias of CORRECT_ANSWER_ALIASES) {
      if (q[alias] !== undefined && q[alias] !== null && q[alias] !== "") {
        correctAnswer = String(q[alias]);
        break;
      }
    }

    // Fallback: use first option
    if (!correctAnswer && options.length > 0) {
      console.warn("[Quiz] Missing correctAnswer for:", questionText);
      correctAnswer = options[0];
    }

    return { question: questionText, options, correctAnswer };
  }).filter(Boolean);

  if (normalized.length === 0) {
    throw new Error("Quiz generation failed: no valid questions extracted.");
  }

  return normalized;
};