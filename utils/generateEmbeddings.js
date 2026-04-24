import { createRequire } from "module";
const require = createRequire(import.meta.url);

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";
import { HfInference } from "@huggingface/inference";
import Embedding from "../models/Embedding.js";
import Resource from "../models/Resource.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const fetchHuggingFaceEmbeddings = async (textChunks, retries = 3, delay = 2000) => {
    const hfToken = process.env.HUGGINGFACE_API_KEY;

    if (!hfToken) {
        throw new Error("HUGGINGFACE_API_KEY is not defined in the environment variables.");
    }

    const hf = new HfInference(hfToken);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await hf.featureExtraction({
                model: "sentence-transformers/all-MiniLM-L6-v2",
                inputs: textChunks,
            });
            return result;
        } catch (error) {
            console.error(`fetchHuggingFaceEmbeddings Error (Attempt ${attempt}/${retries}):`, error.message);
            if (attempt === retries) throw error;
            await sleep(delay * attempt); // Exponential backoff for rate limiting
        }
    }
};

export const extractTextFromFile = async (filePathOrUrl, fileType) => {
    return new Promise((resolve, reject) => {
        const isUrl = filePathOrUrl.startsWith("http://") || filePathOrUrl.startsWith("https://");
        
        // Spawn a background worker to avoid blocking the main event loop (CPU-intensive task)
        const workerPath = path.join(__dirname, "../workers/pdfWorker.js");
        const worker = new Worker(workerPath, {
            workerData: { filePath: filePathOrUrl, fileType, isUrl }
        });

        worker.on("message", (msg) => {
            if (msg.success) resolve(msg.text);
            else {
                console.error("Worker extraction failed:", msg.error);
                resolve(""); // Fallback empty
            }
        });

        worker.on("error", (err) => {
            console.error("Worker thread error:", err);
            resolve("");
        });

        worker.on("exit", (code) => {
            if (code !== 0) console.error(`Worker stopped with exit code ${code}`);
        });
    });
};

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

export const processAndCreateEmbeddings = async (resourceDoc, localFilePath = null, deleteAfter = false) => {
    try {
        console.log(`Starting real embedding generation for resource: ${resourceDoc.name}`);

        let targetPath = localFilePath || resourceDoc.url;
        if (!targetPath.startsWith("http://") && !targetPath.startsWith("https://")) {
            targetPath = path.isAbsolute(targetPath) ? targetPath : path.join(process.cwd(), targetPath);
        }

        const extractedText = await extractTextFromFile(targetPath, resourceDoc.type);

        if (deleteAfter && localFilePath) {
            fs.unlink(localFilePath, (err) => {
                if (err) console.error("Error deleting local file after extraction:", err);
                else console.log(`Deleted local file: ${localFilePath}`);
            });
        }

        if (!extractedText || extractedText.trim().length === 0) {
            console.warn("No text could be extracted from this resource.");
            return;
        }

        const chunks = chunkText(extractedText);
        if (chunks.length === 0) {
            console.warn("Chunks generated length was 0.");
            return;
        }

        const BATCH_SIZE = 50;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);

            const vectors = await fetchHuggingFaceEmbeddings(batch);

            if (vectors && Array.isArray(vectors)) {
                // Use insertMany for bulk DB insertion to avoid hitting connection limits
                const embeddingDocs = batch.map((textChunk, index) => ({
                    user: resourceDoc.user,
                    subject: resourceDoc.subject,
                    resource: resourceDoc._id,
                    textChunk: textChunk,
                    embeddingVector: vectors[index],
                }));
                
                await Embedding.insertMany(embeddingDocs);
            }
        }

        resourceDoc.embeddingCreated = true;
        await resourceDoc.save();

        console.log(`Successfully generated and saved embeddings for resource: ${resourceDoc.name}`);
    } catch (error) {
        console.error(`Failed to process embeddings for resource ${resourceDoc._id}:`, error);
    }
};
