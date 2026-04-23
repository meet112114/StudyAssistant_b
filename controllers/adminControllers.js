import User from "../models/Users.js";
import Subject from "../models/Subject.js";
import Resource from "../models/Resource.js";

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

            return {
                _id: u._id,
                name: u.name,
                email: u.email,
                role: u.role,
                isVerified: u.isVerified,
                createdAt: u.createdAt,
                subjectsCount,
                resourcesCount,
                aiUsage: u.aiUsage,
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

        const creditsToAdd = amountRs * 500; // 1 Rs = 500 credits

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
