import dotenv from "dotenv";
dotenv.config(); // ← MUST be first, before any other imports that read process.env

import app from "./app.js";
import { connectDB } from "./configs/db.js";

connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});