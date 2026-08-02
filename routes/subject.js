import express from "express";
import { getSubjects, addSubject, getSubjectById, deleteSubject, getPublicSubjects, getPublicSubjectById, updateSubject } from "../controllers/subjectControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";

const router = express.Router();

// Public routes (no auth required)
router.get("/public", getPublicSubjects);
router.get("/public/:id", getPublicSubjectById);

// Authenticated routes
router.get("/", verifyAuth, getSubjects);
router.post("/", verifyAuth, addSubject);
router.get("/:id", verifyAuth, getSubjectById);
router.put("/:id", verifyAuth, updateSubject);
router.delete("/:id", verifyAuth, deleteSubject);

export default router;
