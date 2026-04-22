import fs from "fs";
import path from "path";
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
        const resource = await Resource.findOne({ _id: id, user: req.user._id });
        if (!resource) return res.status(404).json({ message: "Resource not found" });

        let quizItem = await Quiz.findOne({ resource: id });
        if (!quizItem) {
            const questions = await generateQuizForResource(resource);
            quizItem = new Quiz({ resource: id, questions });
            await quizItem.save();
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
