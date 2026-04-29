import express from "express";
import { getAdminDashboard, getAdminUsers, addCredits, toggleUserBlock, deleteUser, verifyUser } from "../controllers/adminControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";

const router = express.Router();

// Middleware to check for admin role
const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: "Access denied. Admin only." });
    }
};

router.get("/dashboard", verifyAuth, verifyAdmin, getAdminDashboard);
router.get("/users", verifyAuth, verifyAdmin, getAdminUsers);
router.post("/users/:userId/add-credits", verifyAuth, verifyAdmin, addCredits);
router.put("/users/:userId/toggle-block", verifyAuth, verifyAdmin, toggleUserBlock);
router.put("/users/:userId/verify", verifyAuth, verifyAdmin, verifyUser);
router.delete("/users/:userId", verifyAuth, verifyAdmin, deleteUser);

export default router;
