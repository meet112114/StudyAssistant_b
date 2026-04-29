import ResourcePack from "../models/ResourcePack.js";
import Subject from "../models/Subject.js";
import Resource from "../models/Resource.js";
import { processAndCreateEmbeddings } from "../utils/generateEmbeddings.js";

// Admin: Create a new resource pack by bundling their own subjects
export const createResourcePack = async (req, res) => {
    try {
        const { name, description, subjectIds } = req.body;
        if (!name || !subjectIds || !Array.isArray(subjectIds)) return res.status(400).json({ message: "Name and subjectIds array required" });

        // Find the subjects owned by the admin
        const adminSubjects = await Subject.find({ _id: { $in: subjectIds }, user: req.user._id }).populate("resources");
        
        const subjectsData = adminSubjects.map(sub => ({
            name: sub.name,
            originalSubjectId: sub._id,
            resources: sub.resources.map(res => ({
                name: res.name,
                type: res.type,
                size: res.size,
                url: res.url,
                originalResourceId: res._id
            }))
        }));

        const newPack = new ResourcePack({
            name,
            description,
            subjects: subjectsData,
            createdBy: req.user._id,
            isVisible: true
        });

        await newPack.save();
        res.status(201).json(newPack);
    } catch (err) {
        console.error("Error creating resource pack:", err);
        res.status(500).json({ message: "Server error creating resource pack" });
    }
};

// User/Admin: Get all resource packs (users only see visible)
export const getResourcePacks = async (req, res) => {
    try {
        const query = req.user.role === 'admin' ? {} : { isVisible: true };
        const packs = await ResourcePack.find(query).populate("createdBy", "name").sort({ createdAt: -1 });
        res.json(packs);
    } catch (err) {
        console.error("Error fetching resource packs:", err);
        res.status(500).json({ message: "Server error fetching resource packs" });
    }
};

export const togglePackVisibility = async (req, res) => {
    try {
        const pack = await ResourcePack.findById(req.params.id);
        if (!pack) return res.status(404).json({ message: "Pack not found" });

        pack.isVisible = !pack.isVisible;
        await pack.save();
        res.json(pack);
    } catch (err) {
        console.error("Error toggling visibility:", err);
        res.status(500).json({ message: "Server error toggling visibility" });
    }
};

export const deleteResourcePack = async (req, res) => {
    try {
        await ResourcePack.findByIdAndDelete(req.params.id);
        res.json({ message: "Resource pack deleted" });
    } catch (err) {
        console.error("Error deleting pack:", err);
        res.status(500).json({ message: "Server error deleting pack" });
    }
};

export const updateResourcePack = async (req, res) => {
    try {
        const { name, description, subjectIds } = req.body;
        const pack = await ResourcePack.findById(req.params.id);
        if (!pack) return res.status(404).json({ message: "Pack not found" });

        if (name) pack.name = name;
        if (description !== undefined) pack.description = description;
        
        if (subjectIds && Array.isArray(subjectIds)) {
            const adminSubjects = await Subject.find({ _id: { $in: subjectIds }, user: req.user._id }).populate("resources");
            const subjectsData = adminSubjects.map(sub => ({
                name: sub.name,
                originalSubjectId: sub._id,
                resources: sub.resources.map(res => ({
                    name: res.name,
                    type: res.type,
                    size: res.size,
                    url: res.url,
                    originalResourceId: res._id
                }))
            }));
            pack.subjects = subjectsData;
        }

        await pack.save();
        res.json(pack);
    } catch (err) {
        console.error("Error updating pack:", err);
        res.status(500).json({ message: "Server error updating pack" });
    }
};

// User: Clone a resource pack to their account
export const cloneResourcePack = async (req, res) => {
    try {
        const pack = await ResourcePack.findById(req.params.id);
        if (!pack) return res.status(404).json({ message: "Resource pack not found" });

        // Iterate through the subjects in the pack
        for (const packSubject of pack.subjects) {
            // Check if user already has a subject with this name
            let userSubject = await Subject.findOne({ name: packSubject.name, user: req.user._id });
            
            if (!userSubject) {
                userSubject = new Subject({
                    name: packSubject.name,
                    user: req.user._id,
                    resources: []
                });
                await userSubject.save();
            }

            // Create resources
            for (const packRes of packSubject.resources) {
                // Check if resource already exists in this subject for this user to avoid duplicates
                const existingRes = await Resource.findOne({
                    name: packRes.name,
                    subject: userSubject._id,
                    user: req.user._id
                });

                if (!existingRes) {
                    const newResource = new Resource({
                        name: packRes.name,
                        user: req.user._id,
                        subject: userSubject._id,
                        type: packRes.type,
                        size: packRes.size,
                        url: packRes.url,
                        originalResourceId: packRes.originalResourceId,
                        embeddingCreated: true // Uses original's embeddings
                    });
                    await newResource.save();

                    // Add to subject
                    await Subject.findByIdAndUpdate(userSubject._id, { $push: { resources: newResource._id } });

                    // DO NOT call processAndCreateEmbeddings! We will use the admin's original embeddings.
                }
            }
        }

        res.json({ message: "Resource pack successfully added to your account!" });
    } catch (err) {
        console.error("Error cloning resource pack:", err);
        res.status(500).json({ message: "Server error cloning resource pack" });
    }
};
