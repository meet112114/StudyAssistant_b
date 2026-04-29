import User from "../models/Users.js";
import Subject from "../models/Subject.js";
import Resource from "../models/Resource.js";
import Embedding from "../models/Embedding.js";
import { getCreditsPerRs } from "../utils/llmProvider.js";

// GET /admin/dashboard
export const getAdminDashboard = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalSubjects = await Subject.countDocuments();
        const totalResources = await Resource.countDocuments();

        const users = await User.find({});
        let totalCreditsUsed = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        users.forEach(u => {
            totalCreditsUsed += (u.credits?.totalUsed || 0);
            totalInputTokens += (u.aiUsage?.inputTokens || 0);
            totalOutputTokens += (u.aiUsage?.outputTokens || 0);
        });

        res.json({
            totalUsers,
            totalSubjects,
            totalResources,
            totalCreditsUsed,
            totalInputTokens,
            totalOutputTokens
        });
    } catch (err) {
        console.error("Error in getAdminDashboard:", err);
        res.status(500).json({ message: "Server error fetching dashboard stats" });
    }
};

// GET /admin/users
export const getAdminUsers = async (req, res) => {
    try {
        const users = await User.find({}).lean();

        // Populate subject count and resource count per user
        const usersWithStats = await Promise.all(users.map(async (u) => {
            const subjectsCount = await Subject.countDocuments({ user: u._id });
            const resourcesCount = await Resource.countDocuments({ user: u._id });

            const moneySpent = (u.credits?.transactions || [])
                .filter(t => t.type === 'credit')
                .reduce((sum, t) => sum + (t.amountInRs || 0), 0);

            return {
                _id: u._id,
                name: u.name,
                email: u.email,
                role: u.role,
                rollNumber: u.rollNumber,
                isVerified: u.isVerified,
                isBlocked: u.isBlocked || false,
                createdAt: u.createdAt,
                subjectsCount,
                resourcesCount,
                aiUsage: u.aiUsage,
                moneySpent,
                credits: {
                    balance: u.credits?.balance || 0,
                    totalPurchased: u.credits?.totalPurchased || 0,
                    totalUsed: u.credits?.totalUsed || 0,
                }
            };
        }));

        res.json(usersWithStats);
    } catch (err) {
        console.error("Error in getAdminUsers:", err);
        res.status(500).json({ message: "Server error fetching users" });
    }
};

// POST /admin/users/:userId/add-credits
export const addCredits = async (req, res) => {
    try {
        const { userId } = req.params;
        const { amountRs } = req.body;

        if (!amountRs || amountRs <= 0) {
            return res.status(400).json({ message: "Invalid amount" });
        }

        const creditsPerRs = getCreditsPerRs();
        const creditsToAdd = amountRs * creditsPerRs;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (!user.credits) {
            user.credits = { balance: 0, totalPurchased: 0, totalUsed: 0 };
        }

        user.credits.balance = (user.credits.balance || 0) + creditsToAdd;
        user.credits.totalPurchased = (user.credits.totalPurchased || 0) + creditsToAdd;

        await user.save();

        res.json({
            message: "Credits added successfully",
            creditsAdded: creditsToAdd,
            newBalance: user.credits.balance,
            totalPurchased: user.credits.totalPurchased
        });
    } catch (err) {
        console.error("Error in addCredits:", err);
        res.status(500).json({ message: "Server error adding credits" });
    }
};

// PUT /admin/users/:userId/toggle-block
export const toggleUserBlock = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.role === 'admin') {
            return res.status(403).json({ message: "Cannot block an admin user." });
        }

        user.isBlocked = !user.isBlocked;
        await user.save();

        res.json({ message: `User ${user.isBlocked ? 'blocked' : 'unblocked'} successfully.`, isBlocked: user.isBlocked });
    } catch (err) {
        console.error("Error in toggleUserBlock:", err);
        res.status(500).json({ message: "Server error toggling block status" });
    }
};

// DELETE /admin/users/:userId
export const deleteUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.role === 'admin') {
            return res.status(403).json({ message: "Cannot delete an admin user." });
        }

        // Cascade delete all user data
        await Embedding.deleteMany({ user: userId });
        await Resource.deleteMany({ user: userId });
        await Subject.deleteMany({ user: userId });
        // Optionally, QnASets and Summaries if they exist, assuming they have 'user' field

        await User.findByIdAndDelete(userId);

        res.json({ message: "User and all associated data deleted successfully." });
    } catch (err) {
        console.error("Error in deleteUser:", err);
        res.status(500).json({ message: "Server error deleting user" });
    }
};

// PUT /admin/users/:userId/verify
export const verifyUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.isVerified) {
            return res.status(400).json({ message: "User is already verified." });
        }

        user.isVerified = true;
        if (!user.credits) {
            user.credits = { balance: 0, totalPurchased: 0, totalUsed: 0 };
        }

        user.credits.balance = 1000;

        await user.save();

        res.json({ message: "User verified successfully." });
    } catch (err) {
        console.error("Error in verifyUser:", err);
        res.status(500).json({ message: "Server error verifying user" });
    }
};
