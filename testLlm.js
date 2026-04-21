import dotenv from "dotenv";
import { chatCompletion } from "./utils/llmProvider.js";

dotenv.config(); // load env variables so it reads LLM_PROVIDER

(async () => {
    try {
        console.log("Testing llmProvider...");
        const result = await chatCompletion([
            { role: "user", content: "Say 'Hello' and nothing else." }
        ], { maxTokens: 50, temperature: 0.1 });
        console.log("Result:", result);
    } catch (e) {
        console.error("Error:", e.message);
    }
})();
