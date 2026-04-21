import { fetchHuggingFaceEmbeddings } from "./generateEmbeddings.js";
import { chatCompletion } from "./llmProvider.js";
import Embedding from "../models/Embedding.js";


const cosineSimilarity = (a, b) => {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

// Build a style-aware system prompt for QnA answer generation
const buildSystemPrompt = ({ style, size, tone, language, contextChunks }) => {
  const sizeGuide = {
    short: "Give a concise answer in 1–3 sentences.",
    medium: "Give a balanced answer in 3–6 sentences.",
    long: "Give a thorough answer with good detail and explanation.",
    detailed: "Give a comprehensive, well-structured answer covering all aspects.",
  }[size] || "Give a balanced answer.";

  const toneGuide = {
    professional: "Use a professional, formal tone.",
    simple: "Use simple, easy-to-understand language suitable for a beginner student.",
    friendly: "Use a friendly, encouraging, and approachable tone.",
    academic: "Use precise, academic, scholarly language with correct terminology.",
  }[tone] || "Use a professional tone.";

  const styleGuide = {
    explanatory: "Explain the concept thoroughly with reasoning and examples.",
    concise: "Be direct. No padding, no unnecessary elaboration.",
    socratic: "Answer using guiding questions that help the student think through the answer themselves.",
    stepbystep: "Break down the answer into clear, numbered steps.",
    bullet: "Format the answer as clear bullet points.",
  }[style] || "Explain the concept thoroughly.";

  const languageGuide = language && language !== "english"
    ? `Respond in ${language}.`
    : "";

  const contextBlock = contextChunks && contextChunks.length > 0
    ? `\n\nRelevant excerpts from the selected study materials:\n---\n${contextChunks.join("\n---\n")}\n---\n`
    : "\n\nNo specific excerpts found. Use your general knowledge.\n";

  return `You are an expert AI study assistant generating answers for a Q&A set.

${sizeGuide}
${toneGuide}
${styleGuide}
${languageGuide}

Base your answer on the study material excerpts when relevant. If not covered, provide the best general answer.
${contextBlock}

Return ONLY the answer text — no preamble, no labels, no "Answer:" prefix.`;
};

// ── Retrieve relevant context chunks from embeddings for a query ───────────────
const getContextChunks = async (question, resourceIds, userId) => {
  try {
    const embResult = await fetchHuggingFaceEmbeddings([question]);
    const queryVector = embResult[0];

    const allEmbeddings = await Embedding.find({
      resource: { $in: resourceIds },
      user: userId,
    }).select("textChunk embeddingVector").lean();

    const scored = allEmbeddings.map((emb) => ({
      textChunk: emb.textChunk,
      score: cosineSimilarity(queryVector, emb.embeddingVector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((s) => s.textChunk);
  } catch (e) {
    console.error("[QnA] Context retrieval failed:", e.message);
    return [];
  }
};

// ── Answer a single question ───────────────────────────────────────────────────
export const answerSingleQuestion = async ({ question, resourceIds, userId, settings = {} }) => {
  const { style = "explanatory", size = "medium", tone = "professional", language = "english" } = settings;

  const contextChunks = resourceIds?.length > 0
    ? await getContextChunks(question, resourceIds, userId)
    : [];

  const systemPrompt = buildSystemPrompt({ style, size, tone, language, contextChunks });

  const messages = [
    { role: "user", content: systemPrompt },
    { role: "assistant", content: "Understood! I will answer based on the study material and your preferences." },
    { role: "user", content: question },
  ];

  const maxTokens = size === "short" ? 150 : size === "medium" ? 350 : size === "detailed" ? 900 : 600;
  const temperature = tone === "academic" ? 0.3 : 0.6;

  const answer = await chatCompletion(messages, { maxTokens, temperature, userId });
  return answer.trim();
};



// ── Answer a batch of questions with the same settings ────────────────────────
export const answerBatchQuestions = async ({ questions, resourceIds, userId, settings = {} }) => {
  const results = [];
  for (const q of questions) {
    try {
      const answer = await answerSingleQuestion({ question: q, resourceIds, userId, settings });
      results.push({ question: q, answer, error: null });
    } catch (e) {
      console.error("[QnA] Batch question failed:", q, e.message);
      results.push({ question: q, answer: "", error: e.message });
    }
  }
  return results;
};
