import dotenv from "dotenv";
dotenv.config();

process.on('uncaughtException', (err) => {
    console.error('FATAL UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED PROMISE REJECTION:', reason);
});

import app from "./app.js";
import { connectDB } from "./configs/db.js";

connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Prevent event loop from ever emptying
  setInterval(() => {}, 1000 * 60 * 60);
});