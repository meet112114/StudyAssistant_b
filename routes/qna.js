import express from "express";
import verifyAuth from "../middlewares/verifyAuth.js";
import {
  createQnaSet,
  getQnaSets,
  getQnaSetById,
  updateQnaSet,
  deleteQnaSet,
  addQuestions,
  answerQuestion,
  answerAllQuestions,
  deleteQuestion,
  getPublicQnaSets,
  getPublicQnaSetById,
  generatePdfFromQna,
  generatePdfFromQnaPrivate,
} from "../controllers/qnaControllers.js";

const router = express.Router();

router.get('/test-crash', async (req, res) => {
  try {
    throw new Error('Insufficient credits. Please recharge your account.');
  } catch (err) {
    console.error('Error generating/fetching quiz:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── Public routes (no auth required) ─────────────────────────────────────────
router.get("/public", getPublicQnaSets);
router.get("/public/:id", getPublicQnaSetById);
router.get("/pdf/public/:id" , generatePdfFromQna);

// ── Authenticated CRUD ────────────────────────────────────────────────────────
router.post("/", verifyAuth, createQnaSet);
router.get("/", verifyAuth, getQnaSets);
router.get("/:id", verifyAuth, getQnaSetById);
router.put("/:id", verifyAuth, updateQnaSet);
router.delete("/:id", verifyAuth, deleteQnaSet);
router.get("/pdf/:id", verifyAuth, generatePdfFromQnaPrivate);

// ── Question management ───────────────────────────────────────────────────────
router.post("/:id/questions", verifyAuth, addQuestions);
router.delete("/:id/questions/:questionId", verifyAuth, deleteQuestion);

// ── AI answering ──────────────────────────────────────────────────────────────
router.post("/:id/questions/:questionId/answer", verifyAuth, answerQuestion);
router.post("/:id/answer-all", verifyAuth, answerAllQuestions);

export default router;

