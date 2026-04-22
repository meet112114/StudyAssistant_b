import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "./models/Users.js";
import { chatCompletion } from "./utils/llmProvider.js";

dotenv.config();

(async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/StudyAssistant");
        console.log("Connected to DB.");
        
        process.env.LLM_PROVIDER = "hf"; // force HF

        // Find a user or create one
        let user = await User.findOne();
        if (!user) {
            console.log("No user found, creating a dummy user...");
            user = new User({ name: "Test", email: "test@test.com", password: "password" });
            await user.save();
        }

        console.log(`Initial balance: ${user.credits.balance}`);
        console.log(`Initial transactions length: ${user.credits.transactions.length}`);

        console.log("Calling chatCompletion 3 times (like batch answer)...");
        for (let i = 0; i < 3; i++) {
            await chatCompletion([
                { role: "user", content: `Say 'Hello ${i}'` }
            ], { maxTokens: 50, temperature: 0.1, userId: user._id });
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));

        const updatedUser = await User.findById(user._id);
        console.log(`Final balance: ${updatedUser.credits.balance}`);
        console.log(`Final transactions length: ${updatedUser.credits.transactions.length}`);
        
        process.exit(0);
    } catch (e) {
        console.error("Error:", e.message);
        process.exit(1);
    }
})();
