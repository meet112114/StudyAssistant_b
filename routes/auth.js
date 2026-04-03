import express from "express";
import { register , login } from "../controllers/authControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";

const router = express.Router()

router.post('/register' , register);
router.post('/login' , login);

router.get("/me", verifyAuth, (req, res) => {
  res.json({
    user: req.user
  });
});

export default router;

