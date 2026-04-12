import Subject from "../models/Subject.js";

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

export { getSubjects, addSubject, getSubjectById };
