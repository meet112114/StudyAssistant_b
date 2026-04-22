
import Embedding from "../models/Embedding.js";
import Resource from "../models/Resource.js";
import Subject from "../models/Subject.js";
import { fetchHuggingFaceEmbeddings } from "../utils/generateEmbeddings.js";
import { chatCompletion } from "../utils/llmProvider.js";

// Cosine similarity between two vectors
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

// Get all subjects and their resources for the user
export const getChatResources = async (req, res) => {
    try {
        const subjects = await Subject.find({ user: req.user._id })
            .populate({
                path: "resources",
                select: "name type size embeddingCreated _id"
            })
            .lean();

        res.json(subjects);
    } catch (err) {
        console.error("Error fetching chat resources:", err);
        res.status(500).json({ message: "Server error fetching resources" });
    }
};

// Main chat endpoint
export const chat = async (req, res) => {
    try {
        const {
            resourceIds,        // Array of resource IDs to include
            messages,           // Array of { role, content } — full history
            settings            // { answerLength, language, tone, style, customInstructions }
        } = req.body;

        if (!messages || messages.length === 0) {
            return res.status(400).json({ message: "No messages provided" });
        }

        if (!resourceIds || resourceIds.length === 0) {
            return res.status(400).json({ message: "Please select at least one resource to chat with." });
        }

        // Verify resources belong to the user
        const validResources = await Resource.find({
            _id: { $in: resourceIds },
            user: req.user._id
        }).select("name embeddingCreated");

        if (validResources.length === 0) {
            return res.status(404).json({ message: "No valid resources found." });
        }

        const notReady = validResources.filter(r => !r.embeddingCreated);
        if (notReady.length > 0) {
            return res.status(400).json({
                message: `Resource "${notReady[0].name}" is still being processed. Please wait a moment and try again.`
            });
        }

        // Get the latest user message for embedding search
        const userMessages = messages.filter(m => m.role === "user");
        const latestUserMessage = userMessages[userMessages.length - 1]?.content || "";

        // Embed the user's query
        let queryVector;
        try {
            const embResult = await fetchHuggingFaceEmbeddings([latestUserMessage]);
            queryVector = embResult[0];
        } catch (e) {
            console.error("Query embedding failed:", e);
            queryVector = null;
        }

        // Retrieve relevant chunks from embeddings
        let contextChunks = [];
        if (queryVector) {
            const allEmbeddings = await Embedding.find({
                resource: { $in: resourceIds },
                user: req.user._id
            }).select("textChunk embeddingVector resource").lean();

            // Score and sort
            const scored = allEmbeddings.map(emb => ({
                textChunk: emb.textChunk,
                score: cosineSimilarity(queryVector, emb.embeddingVector)
            }));
            scored.sort((a, b) => b.score - a.score);

            // Take top 6 chunks (balance context vs token limits)
            contextChunks = scored.slice(0, 6).map(s => s.textChunk);
        }

        // Build system prompt based on settings
        const { answerLength = "medium", language = "english", tone = "professional", style = "explanatory", customInstructions = "" } = settings || {};

        const lengthGuide = {
            short: "Keep your answers concise and to the point (1-3 sentences).",
            medium: "Provide a balanced answer with enough detail (3-6 sentences).",
            long: "Provide a thorough, detailed, and comprehensive answer.",
            bullet: "Format your answer as clear bullet points."
        }[answerLength] || "Provide a balanced answer.";

        const toneGuide = {
            professional: "Use a professional and formal tone.",
            simple: "Use simple, easy-to-understand language suitable for a student.",
            friendly: "Use a friendly, encouraging, and approachable tone.",
            academic: "Use precise academic and scholarly language with proper terminology."
        }[tone] || "Use a professional tone.";

        const styleGuide = {
            explanatory: "Explain concepts thoroughly with reasoning.",
            concise: "Be direct and avoid unnecessary elaboration.",
            socratic: "Answer with guiding questions to help the student think.",
            stepbystep: "Break down answers into clear numbered steps."
        }[style] || "Explain concepts thoroughly.";

        const languageGuide = language !== "english"
            ? `Respond in ${language}.`
            : "";

        const contextBlock = contextChunks.length > 0
            ? `\n\nRelevant excerpts from the selected study materials:\n---\n${contextChunks.join("\n---\n")}\n---\n`
            : "\n\nNo specific excerpts were found. Answer based on your general knowledge.\n";

        const systemPrompt = `You are a helpful AI study assistant. Your job is to help students understand their study materials.

${lengthGuide}
${toneGuide}
${styleGuide}
${languageGuide}
${customInstructions ? `Additional instructions: ${customInstructions}` : ""}

Base your answers on the provided study material excerpts when relevant. If the answer cannot be found in the materials, say so clearly and provide a general answer if possible.
${contextBlock}`;

        // Build messages for the configured LLM provider
        const llmMessages = [
            { role: "user", content: systemPrompt },
            { role: "assistant", content: "Understood! I'm ready to help you with your study materials. What would you like to know?" },
            ...messages
        ];

        const maxTokens = answerLength === "long" ? 800 : answerLength === "short" ? 200 : 500;
        const temperature = tone === "academic" ? 0.3 : 0.6;

        const reply = await chatCompletion(llmMessages, { maxTokens, temperature, userId: req.user._id });

        res.json({
            reply,
            resourcesUsed: validResources.map(r => r.name),
            chunksFound: contextChunks.length
        });
    } catch (err) {
        console.error("Chat error:", err);
        const msg = err.message?.includes("Insufficient credits") 
            ? err.message 
            : "AI chat error. Please try again.";
        res.status(500).json({ message: msg });
    }
};
