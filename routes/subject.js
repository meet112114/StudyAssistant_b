import express from "express";
import { getSubjects, addSubject, getSubjectById } from "../controllers/subjectControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";

const router = express.Router();

router.get("/", verifyAuth, getSubjects);
router.post("/", verifyAuth, addSubject);
router.get("/:id", verifyAuth, getSubjectById);

export default router;
