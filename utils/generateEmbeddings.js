import { createRequire } from "module";
const require = createRequire(import.meta.url);

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { HfInference } from "@huggingface/inference";
import OpenAI from "openai";
import Embedding from "../models/Embedding.js";
import Resource from "../models/Resource.js";
import User from "../models/Users.js";
import { calculateEmbeddingCredits } from "./llmProvider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* ─────────────────────────────────────────────────────────────────────────────
   PROVIDER RESOLUTION
   Set EMBEDDING_PROVIDER=openai in .env to use OpenAI, otherwise HuggingFace.
   Optional: OPENAI_EMBEDDING_MODEL (default: text-embedding-3-small)
───────────────────────────────────────────────────────────────────────────── */

const getEmbeddingProvider = () =>
    (process.env.EMBEDDING_PROVIDER || "hf").trim().toLowerCase();

const getOpenAIEmbeddingModel = () =>
    (process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small").trim();

/* ─────────────────────────────────────────────────────────────────────────────
   HUGGING FACE EMBEDDINGS
───────────────────────────────────────────────────────────────────────────── */

let hfInstance = null;

export const fetchHuggingFaceEmbeddings = async (textChunks, retries = 3, delay = 2000) => {
    if (!hfInstance) {
        const hfToken = process.env.HUGGINGFACE_API_KEY;
        if (!hfToken) {
            throw new Error("HUGGINGFACE_API_KEY is not defined in the environment variables.");
        }
        hfInstance = new HfInference(hfToken);
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await hfInstance.featureExtraction({
                model: "sentence-transformers/all-MiniLM-L6-v2",
                inputs: textChunks,
            });
            return result; // Array of float arrays: [ [0.1, 0.2, ...], ... ]
        } catch (error) {
            console.error(`[HF Embeddings] Error (Attempt ${attempt}/${retries}):`, error.message);
            if (attempt === retries) throw error;
            await sleep(delay * attempt); // Exponential backoff
        }
    }
};

/* ─────────────────────────────────────────────────────────────────────────────
   OPENAI EMBEDDINGS
───────────────────────────────────────────────────────────────────────────── */

let openaiInstance = null;

export const fetchOpenAIEmbeddings = async (textChunks, retries = 3, delay = 1000) => {
    if (!openaiInstance) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not defined in the environment variables.");
        }
        openaiInstance = new OpenAI({ apiKey });
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const model = getOpenAIEmbeddingModel();
            const response = await openaiInstance.embeddings.create({
                model,
                input: textChunks,
                encoding_format: "float",
            });
            console.log(`[OpenAI Embeddings] Model: ${model}, chunks: ${textChunks.length}`);
            // Sort by index to preserve order, extract embedding arrays
            const sorted = response.data.sort((a, b) => a.index - b.index);
            return sorted.map(item => item.embedding);
        } catch (error) {
            console.error(`[OpenAI Embeddings] Error (Attempt ${attempt}/${retries}):`, error.message);
            if (attempt === retries) throw error;
            await sleep(delay * attempt);
        }
    }
};

/* ─────────────────────────────────────────────────────────────────────────────
   UNIFIED FETCH — routes to correct provider based on EMBEDDING_PROVIDER env
───────────────────────────────────────────────────────────────────────────── */

export const fetchEmbeddings = async (textChunks) => {
    const provider = getEmbeddingProvider();
    if (provider === "openai") {
        return fetchOpenAIEmbeddings(textChunks);
    }
    return fetchHuggingFaceEmbeddings(textChunks);
};

/* ─────────────────────────────────────────────────────────────────────────────
   TEXT EXTRACTION
───────────────────────────────────────────────────────────────────────────── */

export const extractTextFromFile = async (filePathOrUrl, fileType) => {
    const isUrl = filePathOrUrl.startsWith("http://") || filePathOrUrl.startsWith("https://");

    let fileBuffer = null;

    if (isUrl) {
        try {
            const response = await fetch(filePathOrUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!response.ok) throw new Error(`Failed to fetch remote file: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            fileBuffer = Buffer.from(arrayBuffer);
        } catch (err) {
            console.error("extractTextFromFile fetch failed:", err);
            return "";
        }
    } else {
        fileBuffer = fs.readFileSync(filePathOrUrl);
    }

    let text = "";
    try {
        if (fileType === "pdf") {
            const pdfParseLib = require("pdf-parse");
            const pdfParse = pdfParseLib.default || pdfParseLib;
            const { PDFParse } = pdfParseLib;
            if (PDFParse) {
                const parser = new PDFParse({ data: fileBuffer });
                const result = await parser.getText();
                await parser.destroy();
                text = result.text;
            } else {
                const result = await pdfParse(fileBuffer);
                text = result.text;
            }
        } else if (fileType === "docx") {
            const mammoth = require("mammoth");
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            text = result.value;
        } else if (fileType === "txt") {
            text = fileBuffer.toString("utf-8");
        }
    } catch (err) {
        console.error("Text extraction failed:", err);
        return "";
    }
    return text;
};

/* ─────────────────────────────────────────────────────────────────────────────
   CHUNKING
───────────────────────────────────────────────────────────────────────────── */

export const chunkText = (text) => {
    const chunks = [];
    if (!text) return chunks;

    for (let i = 0; i < text.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
        const slicedChunk = text.slice(i, i + CHUNK_SIZE).trim();
        if (slicedChunk.length > 10) {
            chunks.push(slicedChunk);
        }
    }
    return chunks;
};

/* ─────────────────────────────────────────────────────────────────────────────
   EMBEDDING QUEUE
───────────────────────────────────────────────────────────────────────────── */

const embeddingQueue = [];
let isProcessingQueue = false;

const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    while (embeddingQueue.length > 0) {
        const task = embeddingQueue.shift();
        try {
            await processAndCreateEmbeddingsInternal(task.resourceDoc, task.localFilePath, task.deleteAfter);
        } catch (error) {
            console.error("Queue task failed:", error);
        }
    }
    isProcessingQueue = false;
};

export const processAndCreateEmbeddings = (resourceDoc, localFilePath = null, deleteAfter = false) => {
    embeddingQueue.push({ resourceDoc, localFilePath, deleteAfter });
    processQueue();
};

const processAndCreateEmbeddingsInternal = async (resourceDoc, localFilePath = null, deleteAfter = false) => {
    const provider = getEmbeddingProvider();
    console.log(`[Embeddings] Starting for: "${resourceDoc.name}" | Provider: ${provider.toUpperCase()}`);

    try {
        let targetPath = localFilePath || resourceDoc.url;
        if (!targetPath.startsWith("http://") && !targetPath.startsWith("https://")) {
            if (targetPath.startsWith('/resources/')) {
                targetPath = path.join(process.cwd(), targetPath.substring(1));
            } else {
                targetPath = path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
            }
        }

        const extractedText = await extractTextFromFile(targetPath, resourceDoc.type);

        if (deleteAfter && localFilePath) {
            fs.unlink(localFilePath, (err) => {
                if (err) console.error("Error deleting local file after extraction:", err);
                else console.log(`Deleted local file: ${localFilePath}`);
            });
        }

        if (!extractedText || extractedText.trim().length === 0) {
            console.warn("[Embeddings] No text could be extracted from this resource.");
            return;
        }

        const chunks = chunkText(extractedText);
        if (chunks.length === 0) {
            console.warn("[Embeddings] Chunked text was empty.");
            return;
        }

        // OpenAI handles larger batches efficiently (batch API call);
        // HF is limited by payload size so keep batches small.
        const BATCH_SIZE = provider === "openai" ? 20 : 5;

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);

            const vectors = await fetchEmbeddings(batch);

            if (vectors && Array.isArray(vectors)) {
                const embeddingDocs = batch.map((textChunk, index) => ({
                    user: resourceDoc.user,
                    subject: resourceDoc.subject,
                    resource: resourceDoc._id,
                    textChunk,
                    embeddingVector: vectors[index],
                }));

                await Embedding.insertMany(embeddingDocs);
            }
        }

        resourceDoc.embeddingCreated = true;
        await resourceDoc.save();

        // ── Credit deduction for embedding generation ──────────────────────
        // Estimate total tokens from all chunk text (chars / 4 is the standard approximation)
        const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
        const estimatedTokens = Math.ceil(totalChars / 4);
        const { creditsUsed, totalCostRs } = calculateEmbeddingCredits(provider, estimatedTokens);

        if (resourceDoc.user) {
            try {
                // Always track embedding tokens in aiUsage, regardless of cost
                await User.updateOne(
                    { _id: resourceDoc.user },
                    { $inc: { 'aiUsage.inputTokens': estimatedTokens } }
                );

                // Deduct credits only if this provider has a cost
                if (creditsUsed > 0) {
                    const user = await User.findById(resourceDoc.user);
                    if (user) {
                        await user.deductCredits(
                            creditsUsed,
                            totalCostRs,
                            `Embedding · ${provider.toUpperCase()} · ${estimatedTokens} tokens · ${resourceDoc.name}`
                        );
                        console.log(`[Embeddings] Deducted ${creditsUsed} credits (₹${totalCostRs}) from user ${user._id}`);
                    }
                }
            } catch (creditErr) {
                // Never fail embedding success due to a billing error
                console.error("[Embeddings] Credit/token tracking failed:", creditErr.message);
            }
        }

        console.log(`[Embeddings] Done: "${resourceDoc.name}" | ${provider.toUpperCase()} | ${chunks.length} chunks | ~${estimatedTokens} tokens`);
    } catch (error) {
        console.error(`[Embeddings] Failed for resource ${resourceDoc._id}:`, error);
    }
};
