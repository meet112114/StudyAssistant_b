import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getItems, createFolder, uploadFile, deleteItem } from "../controllers/staticItemControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";

const router = express.Router();

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "public", "static-files");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/static-files/");
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext).replace(/\s+/g, "_");
    cb(null, `${basename}_${Date.now()}${ext}`);
  },
});

const upload = multer({ storage });

// Admin verification middleware
const verifyAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Access denied. Admin only." });
  }
};

// Public route (unauthenticated guest access allowed)
router.get("/", getItems);

// Admin-only routes
router.post("/folder", verifyAuth, verifyAdmin, createFolder);
router.post("/upload", verifyAuth, verifyAdmin, upload.single("file"), uploadFile);
router.delete("/:id", verifyAuth, verifyAdmin, deleteItem);

export default router;
