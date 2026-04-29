import mongoose from "mongoose";
import dotenv from "dotenv";
import ResourcePack from "./models/ResourcePack.js";
import User from "./models/Users.js";

dotenv.config();

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to DB");

        // Find an admin user to assign as the creator
        const admin = await User.findOne({ role: "admin" });
        if (!admin) {
            console.error("No admin user found! Please register an admin user first.");
            process.exit(1);
        }

        const mcaSem1Pack = new ResourcePack({
            name: "MCA SEM 1 (Core Subjects)",
            description: "Essential study materials, syllabus, and notes for MCA Semester 1.",
            createdBy: admin._id,
            subjects: [
                {
                    name: "Data Structures",
                    resources: [
                        {
                            name: "DS_Syllabus.pdf",
                            type: "pdf",
                            size: 102400,
                            url: "https://res.cloudinary.com/demo/image/upload/sample.pdf" // Example URL
                        }
                    ]
                },
                {
                    name: "Database Management Systems",
                    resources: [
                        {
                            name: "DBMS_Notes.pdf",
                            type: "pdf",
                            size: 204800,
                            url: "https://res.cloudinary.com/demo/image/upload/sample.pdf" // Example URL
                        }
                    ]
                }
            ]
        });

        await mcaSem1Pack.save();
        console.log("Successfully created 'MCA SEM 1' resource pack!");
        process.exit(0);

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

seed();
