import { createRequire } from "module";
const require = createRequire(import.meta.url);

import fs from "fs";
import path from "path";
const pdfParseLib = require("pdf-parse");
const pdfParse = pdfParseLib.default || pdfParseLib;
import mammoth from "mammoth";
import { HfInference } from "@huggingface/inference";
import Embedding from "../models/Embedding.js";
import Resource from "../models/Resource.js";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

//  Hugging Face's 
export const fetchHuggingFaceEmbeddings = async (textChunks) => {
    const hfToken = process.env.HUGGINGFACE_API_KEY;

    if (!hfToken) {
        throw new Error("HUGGINGFACE_API_KEY is not defined in the environment variables.");
    }

    const hf = new HfInference(hfToken);

    try {
        const result = await hf.featureExtraction({
            model: "sentence-transformers/all-MiniLM-L6-v2",
            inputs: textChunks,
        });

        return result;
    } catch (error) {
        console.error("fetchHuggingFaceEmbeddings Error:", error);
        throw error;
    }
};

export const extractTextFromFile = async (filePath, fileType) => {
    try {
        const fileBuffer = fs.readFileSync(filePath);

        if (fileType === "pdf") {
            const { PDFParse } = pdfParseLib;
            if (PDFParse) {
                const parser = new PDFParse({ data: fileBuffer });
                const result = await parser.getText();
                await parser.destroy();
                return result.text;
            } else {
                // Fallback incase object is directly the wrapper
                const result = await pdfParseLib(fileBuffer);
                return result.text;
            }
        } else if (fileType === "docx") {
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            return result.value;
        } else if (fileType === "txt") {
            return fileBuffer.toString("utf-8");
        } else {
            console.warn(`Unsupported extraction type: ${fileType}`);
        }
    } catch (error) {
        console.error(`Error reading/extracting file: ${filePath}`, error);
    }
    return "";
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

export const processAndCreateEmbeddings = async (resourceDoc) => {
    try {
        console.log(`Starting real embedding generation for resource: ${resourceDoc.name}`);

        const filePath = path.join(process.cwd(), resourceDoc.url);

        const extractedText = await extractTextFromFile(filePath, resourceDoc.type);
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

                const mongooseBatchPromises = batch.map((textChunk, index) => {
                    const embeddingVector = vectors[index];

                    const newEmbedding = new Embedding({
                        user: resourceDoc.user,
                        subject: resourceDoc.subject,
                        resource: resourceDoc._id,
                        textChunk: textChunk,
                        embeddingVector: embeddingVector,
                    });

                    return newEmbedding.save();
                });
                await Promise.all(mongooseBatchPromises);
            }
        }

        resourceDoc.embeddingCreated = true;
        await resourceDoc.save();

        console.log(`Successfully generated and saved embeddings for resource: ${resourceDoc.name}`);
    } catch (error) {
        console.error(`Failed to process embeddings for resource ${resourceDoc._id}:`, error);
    }
};
