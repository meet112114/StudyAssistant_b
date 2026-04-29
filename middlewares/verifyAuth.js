import jwt from "jsonwebtoken";
import User from "../models/Users.js";

const verifyAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Access denied. No token provided." });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");

    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: "Account is temporarily blocked by admin." });
    }

    req.user = user;

    next();

  } catch (error) {
    console.error("Auth middleware error:", error.message);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

export default verifyAuth;