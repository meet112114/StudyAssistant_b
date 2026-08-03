import express from "express";
import multer from "multer";
import { addResource, getResources, getResourceById, getSummary, getQuiz, deleteResource, retryEmbedding, getPublicResourceById, getPublicSummary, generateSummary } from "../controllers/resourceControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "resources/");
    },
    filename: (req, file, cb) => {
        const userId = req.user ? req.user._id.toString() : "nouser";
        const subName = req.body.subjectName ? req.body.subjectName.replace(/\s+/g, '_') : "subject";
        const resName = file.originalname.replace(/\s+/g, '_');

        cb(null, `${userId}_${subName}_${resName}`);
    }
});

const upload = multer({ storage });

// Public routes (unauthenticated guest access)
router.get("/public/item/:id", getPublicResourceById);
router.get("/public/item/:id/summary", getPublicSummary);

// Authenticated routes
router.post("/", verifyAuth, upload.single("resourceFile"), addResource);
router.get("/:subjectId", verifyAuth, getResources);

router.get("/item/:id", verifyAuth, getResourceById);
router.get("/item/:id/summary", verifyAuth, getSummary);
router.post("/item/:id/summary", verifyAuth, generateSummary);
router.get("/item/:id/quiz", verifyAuth, getQuiz);
router.delete("/item/:id", verifyAuth, deleteResource);
router.post("/item/:id/retry-embedding", verifyAuth, retryEmbedding);

export default router;
