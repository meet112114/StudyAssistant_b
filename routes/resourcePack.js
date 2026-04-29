import express from "express";
import { createResourcePack, getResourcePacks, cloneResourcePack, togglePackVisibility, deleteResourcePack, updateResourcePack } from "../controllers/resourcePackControllers.js";
import verifyAuth from "../middlewares/verifyAuth.js";

const router = express.Router();

const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: "Access denied. Admin only." });
    }
};

router.get("/", verifyAuth, getResourcePacks);
router.post("/", verifyAuth, verifyAdmin, createResourcePack);
router.post("/:id/clone", verifyAuth, cloneResourcePack);
router.put("/:id/toggle-visibility", verifyAuth, verifyAdmin, togglePackVisibility);
router.put("/:id", verifyAuth, verifyAdmin, updateResourcePack);
router.delete("/:id", verifyAuth, verifyAdmin, deleteResourcePack);

export default router;
