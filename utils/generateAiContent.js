import { HfInference } from "@huggingface/inference";
import path from "path";
import { extractTextFromFile } from "./generateEmbeddings.js";

const MAX_TEXT_LENGTH = 15000;

export const generateSummaryForResource = async (resourceDoc) => {
    const hfToken = process.env.HUGGINGFACE_API_KEY;
    const hf = new HfInference(hfToken);
    const filePath = path.join(process.cwd(), resourceDoc.url);

    let text = await extractTextFromFile(filePath, resourceDoc.type);
    if (!text || text.trim().length === 0) {
        throw new Error("Could not extract text from the resource.");
    }

    const truncatedText = text.slice(0, MAX_TEXT_LENGTH);

    const result = await hf.chatCompletion({
        model: "google/gemma-3-27b-it",
        messages: [
            {
                role: "user",
                content: `You are an educational assistant. Provide a concise, clear, and comprehensive summary of the following text:\n\n${truncatedText}\n\nSummary:`
            }
        ],
        max_tokens: 500,
        temperature: 0.5,
    });

    return result.choices[0].message.content.trim();
};

export const generateQuizForResource = async (resourceDoc) => {
    const hfToken = process.env.HUGGINGFACE_API_KEY;
    const hf = new HfInference(hfToken);
    const filePath = path.join(process.cwd(), resourceDoc.url);

    let text = await extractTextFromFile(filePath, resourceDoc.type);
    if (!text || text.trim().length === 0) {
        throw new Error("Could not extract text from the resource.");
    }

    const truncatedText = text.slice(0, MAX_TEXT_LENGTH);

    const result = await hf.chatCompletion({
        model: "google/gemma-3-27b-it",
        messages: [
            {
                role: "user",
                content: `You are an educational assistant. Create exactly 10 multiple-choice questions based on the following text.
Format the output strictly as a JSON array of objects, with no other text, exactly like this:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": "Option A"
  }
]

Text:\n${truncatedText}`
            }
        ],
        max_tokens: 1500,
        temperature: 0.3,
    });

    let generatedText = result.choices[0].message.content.trim();

    generatedText = generatedText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        return JSON.parse(generatedText);
    } catch (error) {
        console.error("Failed to parse the generated quiz as JSON:", generatedText);
        throw new Error("Failed to generate a properly formatted quiz.");
    }
};