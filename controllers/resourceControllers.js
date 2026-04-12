import fs from "fs";
import path from "path";
import Resource from "../models/Resource.js";
import Subject from "../models/Subject.js";
import { processAndCreateEmbeddings } from "../utils/generateEmbeddings.js";

const resDir = path.join(process.cwd(), "resources");
if (!fs.existsSync(resDir)) {
    fs.mkdirSync(resDir);
}

const addResource = async (req, res) => {
    console.log("addResource called for user:", req.user?._id);
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const { subjectId } = req.body;
        if (!subjectId) {
            return res.status(400).json({ message: "Subject ID is required" });
        }

        const originalName = req.file.originalname;
        const ext = path.extname(originalName).toLowerCase();
        let type = "";

        if (ext === ".pdf") type = "pdf";
        else if (ext === ".docx") type = "docx";
        else if (ext === ".txt") type = "txt";
        else {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: "Unsupported file type. Only pdf, docx, txt allowed." });
        }

        const resource = new Resource({
            name: req.file.originalname,
            user: req.user._id,
            subject: subjectId,
            type,
            size: req.file.size,
            url: `/resources/${req.file.filename}`
        });

        await resource.save();

        await Subject.findByIdAndUpdate(subjectId, { $push: { resources: resource._id } });

        // Kick off asynchronous embedding generation
        processAndCreateEmbeddings(resource);

        res.status(201).json(resource);
    } catch (err) {
        console.error("Error adding resource:", err);
        res.status(500).json({ message: "Server error saving resource" });
    }
};

const getResources = async (req, res) => {
    console.log("getResources called for user:", req.user?._id);
    try {
        const { subjectId } = req.params;
        const resources = await Resource.find({ user: req.user._id, subject: subjectId });
        res.json(resources);
    } catch (err) {
        console.error("Error fetching resources:", err);
        res.status(500).json({ message: "Server error fetching resources" });
    }
};

export { addResource, getResources };
