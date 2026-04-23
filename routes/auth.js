import express from "express";
import { register , login } from "../controllers/authControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";
import Subject from "../models/Subject.js";
import Resource from "../models/Resource.js";
const router = express.Router()

router.post('/register' , register);
router.post('/login' , login);

router.get("/me", verifyAuth, async (req, res) => {
  try {
    const subjectsCount = await Subject.countDocuments({ user: req.user._id });
    const resourcesCount = await Resource.countDocuments({ user: req.user._id });
    res.json({
      user: {
        ...req.user.toObject(),
        subjectsCount,
        resourcesCount
      }
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching user info" });
  }
});

export default router;

