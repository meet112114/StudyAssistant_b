import fs from "fs";
import path from "path";
import cloudinary from "../configs/cloudinary.js";
import Resource from "../models/Resource.js";
import Subject from "../models/Subject.js";
import Summary from "../models/Summary.js";
import Quiz from "../models/Quiz.js";
import { processAndCreateEmbeddings } from "../utils/generateEmbeddings.js";
import { generateSummaryForResource, generateQuizForResource } from "../utils/generateAiContent.js";

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

        let finalUrl = `/resources/${req.file.filename}`;
        
        const isProd = process.env.NODE_ENV === 'production' || (req.hostname !== 'localhost' && req.hostname !== '127.0.0.1');

        if (isProd) {
            try {
                const uploadType = type === 'pdf' ? 'image' : 'raw';
                const publicId = req.file.filename.replace(new RegExp(`\\.${type}$`, 'i'), '');
                const result = await cloudinary.uploader.upload(req.file.path, {
                    resource_type: uploadType,
                    folder: "study_assistant_resources",
                    public_id: publicId,
                    type: 'upload',
                    ...(type === 'pdf' && { format: 'pdf' })
                });
                
                // Cloudinary blocks PDF delivery by default for security. 
                // Generating a Signed URL permanently bypasses this restriction.
                finalUrl = type === 'pdf' 
                    ? cloudinary.url(result.public_id, { secure: true, sign_url: true, resource_type: 'image', format: 'pdf' })
                    : result.secure_url;
                
                // Optionally remove local file after upload to save space
                fs.unlinkSync(req.file.path);
            } catch (cloudErr) {
                console.error("Cloudinary upload failed:", cloudErr);
                // Fallback to local if cloud fails
            }
        }

        const resource = new Resource({
            name: req.file.originalname,
            user: req.user._id,
            subject: subjectId,
            type,
            size: req.file.size,
            url: finalUrl
        });

        await resource.save();

        await Subject.findByIdAndUpdate(subjectId, { $push: { resources: resource._id } });

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

const getResourceById = async (req, res) => {
    try {
        const resource = await Resource.findOne({ _id: req.params.id, user: req.user._id }).populate("subject", "name").lean();
        if (!resource) return res.status(404).json({ message: "Resource not found" });

        const summaryItem = await Summary.findOne({ resource: resource._id });
        const quizItem = await Quiz.findOne({ resource: resource._id });

        res.json({
            ...resource,
            summaryData: summaryItem ? summaryItem.content : null,
            quizData: quizItem ? quizItem.questions : null
        });
    } catch (err) {
        console.error("Error fetching resource:", err);
        res.status(500).json({ message: "Server error fetching resource" });
    }
};

const getSummary = async (req, res) => {
    try {
        const { id } = req.params;
        const resource = await Resource.findOne({ _id: id, user: req.user._id });
        if (!resource) return res.status(404).json({ message: "Resource not found" });

        let summaryItem = await Summary.findOne({ resource: id });
        if (!summaryItem) {
            const content = await generateSummaryForResource(resource);
            summaryItem = new Summary({ resource: id, content });
            await summaryItem.save();
        }
        res.json(summaryItem);
    } catch (err) {
        console.error("Error generating/fetching summary:", err);
        const msg = err.message?.includes("Insufficient credits") 
            ? err.message 
            : "Server error generating summary. Check API limits or size.";
        res.status(500).json({ message: msg });
    }
};

const getQuiz = async (req, res) => {
    try {
        const { id } = req.params;
        const { difficulty = 'medium', numQuestions = 10, regenerate } = req.query;
        const resource = await Resource.findOne({ _id: id, user: req.user._id });
        if (!resource) return res.status(404).json({ message: "Resource not found" });

        let quizItem = await Quiz.findOne({ resource: id });
        
        if (!quizItem || regenerate === 'true') {
            const questions = await generateQuizForResource(resource, difficulty, numQuestions);
            if (quizItem) {
                quizItem.questions = questions;
                await quizItem.save();
            } else {
                quizItem = new Quiz({ resource: id, questions });
                await quizItem.save();
            }
        }
        res.json(quizItem);
    } catch (err) {
        console.error("Error generating/fetching quiz:", err);
        const msg = err.message?.includes("Insufficient credits") 
            ? err.message 
            : "Server error generating quiz. Check API limits or size.";
        res.status(500).json({ message: msg });
    }
};

export { addResource, getResources, getResourceById, getSummary, getQuiz };
