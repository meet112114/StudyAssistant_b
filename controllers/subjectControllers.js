import Subject from "../models/Subject.js";
import Resource from "../models/Resource.js";
import Embedding from "../models/Embedding.js";
import Summary from "../models/Summary.js";
import Quiz from "../models/Quiz.js";
import User from "../models/Users.js";
import cloudinary from "../configs/cloudinary.js";
import fs from "fs";
import path from "path";

const attachSummaryFlags = async (subjectsOrSubject) => {
    if (!subjectsOrSubject) return subjectsOrSubject;
    const isArray = Array.isArray(subjectsOrSubject);
    const subjects = isArray ? subjectsOrSubject : [subjectsOrSubject];
    
    // Find all resource IDs
    const resourceIds = [];
    subjects.forEach(sub => {
        if (sub && sub.resources) {
            sub.resources.forEach(r => {
                if (r && r._id) {
                    resourceIds.push(r._id);
                }
            });
        }
    });

    if (resourceIds.length === 0) {
        return subjectsOrSubject;
    }

    // Find which resources have summaries
    const summaries = await Summary.find({ resource: { $in: resourceIds } }).select('resource');
    const summarizedResourceIds = new Set(summaries.map(s => s.resource.toString()));

    // Map subjects
    const mapped = subjects.map(sub => {
        const subObj = typeof sub.toObject === 'function' ? sub.toObject() : sub;
        if (subObj.resources) {
            subObj.resources = subObj.resources.map(r => {
                const rObj = typeof r.toObject === 'function' ? r.toObject() : r;
                return {
                    ...rObj,
                    hasSummary: summarizedResourceIds.has(rObj._id.toString())
                };
            });
        }
        return subObj;
    });

    return isArray ? mapped : mapped[0];
};

const getSubjects = async (req, res) => {
    try {
        const subjects = await Subject.find({ user: req.user._id }).populate('resources');
        const subjectsWithFlags = await attachSummaryFlags(subjects);
        res.json(subjectsWithFlags);
    } catch (err) {
        console.error('Error fetching subjects:', err);
        res.status(500).json({ message: 'Server error retrieving subjects' });
    }
};

const addSubject = async (req, res) => {
    try {
        const { name, semester } = req.body;

        if (!name) {
            return res.status(400).json({ message: "Subject name is required" });
        }

        const newSubject = new Subject({
            name,
            semester: semester || "MCA Sem 1",
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

const getPublicSubjects = async (req, res) => {
    try {
        const { semester } = req.query;
        // Find all admin user IDs so guest dashboard only shows subjects uploaded by admin accounts
        const adminUsers = await User.find({ role: 'admin' }).select('_id');
        const adminUserIds = adminUsers.map(u => u._id);

        const query = { user: { $in: adminUserIds } };
        if (semester) {
            query.semester = semester;
        }
        const subjects = await Subject.find(query).populate('resources');
        const subjectsWithFlags = await attachSummaryFlags(subjects);
        res.json(subjectsWithFlags);
    } catch (err) {
        console.error('Error fetching public subjects:', err);
        res.status(500).json({ message: 'Server error retrieving public subjects' });
    }
};

const getPublicSubjectById = async (req, res) => {
    try {
        const subject = await Subject.findById(req.params.id).populate('resources');
        if (!subject) {
            return res.status(404).json({ message: "Subject not found" });
        }
        const subjectWithFlags = await attachSummaryFlags(subject);
        res.json(subjectWithFlags);
    } catch (err) {
        console.error('Error fetching public subject by id:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

const getSubjectById = async (req, res) => {
    try {
        const subject = await Subject.findOne({ _id: req.params.id, user: req.user._id }).populate('resources');
        if (!subject) {
            return res.status(404).json({ message: "Subject not found" });
        }
        const subjectWithFlags = await attachSummaryFlags(subject);
        res.json(subjectWithFlags);
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

const updateSubject = async (req, res) => {
    try {
        const { name, semester } = req.body;
        const subjectId = req.params.id;

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (semester !== undefined) updateData.semester = semester;

        const subject = await Subject.findOneAndUpdate(
            { _id: subjectId, user: req.user._id },
            { $set: updateData },
            { new: true }
        ).populate('resources');

        if (!subject) {
            if (req.user.role === 'admin') {
                const adminSubject = await Subject.findByIdAndUpdate(
                    subjectId,
                    { $set: updateData },
                    { new: true }
                ).populate('resources');
                if (!adminSubject) return res.status(404).json({ message: "Subject not found" });
                const subjectWithFlags = await attachSummaryFlags(adminSubject);
                return res.json(subjectWithFlags);
            }
            return res.status(404).json({ message: "Subject not found" });
        }

        const subjectWithFlags = await attachSummaryFlags(subject);
        res.json(subjectWithFlags);
    } catch (err) {
        console.error("Error updating subject:", err);
        res.status(500).json({ message: "Server error updating subject" });
    }
};

export { getSubjects, addSubject, getSubjectById, deleteSubject, getPublicSubjects, getPublicSubjectById, updateSubject };
