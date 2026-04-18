import express from "express";
import { getChatResources, chat } from "../controllers/chatControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";

const router = express.Router();

router.get("/resources", verifyAuth, getChatResources);
router.post("/", verifyAuth, chat);

export default router;
