import Subject from "../models/Subject.js";
import Resource from "../models/Resource.js";
import Embedding from "../models/Embedding.js";
import Summary from "../models/Summary.js";
import Quiz from "../models/Quiz.js";
import cloudinary from "../configs/cloudinary.js";
import fs from "fs";
import path from "path";

const getSubjects = async (req, res) => {
    try {
        const subjects = await Subject.find({ user: req.user._id }).populate('resources');
        res.json(subjects);
    } catch (err) {
        console.error('Error fetching subjects:', err);
        res.status(500).json({ message: 'Server error retrieving subjects' });
    }
};

const addSubject = async (req, res) => {
    try {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ message: "Subject name is required" });
        }

        const newSubject = new Subject({
            name,
            user: req.user._id,
            resources: []
        });

        await newSubject.save();
        res.status(201).json(newSubject);
    } catch (err) {
        console.error('Error adding subject:', err);
        res.status(500).json({ message: 'Server error saving subject' });
    }
};

const getSubjectById = async (req, res) => {
    try {
        const subject = await Subject.findOne({ _id: req.params.id, user: req.user._id }).populate('resources');
        if (!subject) {
            return res.status(404).json({ message: "Subject not found" });
        }
        res.json(subject);
    } catch (err) {
        console.error('Error fetching subject by id:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

const deleteSubject = async (req, res) => {
    try {
        const subjectId = req.params.id;
        const subject = await Subject.findOne({ _id: subjectId, user: req.user._id });

        if (!subject) {
            return res.status(404).json({ message: "Subject not found" });
        }

        const resources = await Resource.find({ subject: subjectId });

        const deletePromises = resources.map(async (resource) => {
            if (resource.url.includes("res.cloudinary.com")) {
                try {
                    const urlParts = resource.url.split('/');
                    let fileNameWithExt = urlParts[urlParts.length - 1];
                    fileNameWithExt = fileNameWithExt.split('?')[0];
                    const publicIdRaw = fileNameWithExt.replace(/\.[^/.]+$/, "");
                    const fullPublicId = `study_assistant_resources/${publicIdRaw}`;
                    const uploadType = resource.type === 'pdf' ? 'image' : 'raw';
                    await cloudinary.uploader.destroy(fullPublicId, { resource_type: uploadType });
                } catch (cloudErr) {
                    console.error("Error deleting from Cloudinary:", cloudErr);
                }
            } else {
                const filePath = path.join(process.cwd(), resource.url.startsWith('/resources/') ? resource.url.substring(1) : resource.url);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            await Embedding.deleteMany({ resource: resource._id });
            await Summary.deleteMany({ resource: resource._id });
            await Quiz.deleteMany({ resource: resource._id });
            await Resource.findByIdAndDelete(resource._id);
        });

        await Promise.all(deletePromises);

        await Subject.findByIdAndDelete(subjectId);

        res.json({ message: "Subject and all resources deleted successfully" });
    } catch (err) {
        console.error("Error deleting subject:", err);
        res.status(500).json({ message: "Server error deleting subject" });
    }
};

export { getSubjects, addSubject, getSubjectById, deleteSubject };
