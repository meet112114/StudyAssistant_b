import User from "../models/Users.js";
import jwt from "jsonwebtoken";

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback_secret', {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
};


const register = async(req , res) =>{
    try {
        const { email, password, name , role } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        if(!["admin", "student"].includes(role.toLowerCase())){
            return res.status(400).json({ message: 'Role must be admin or student' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'An account with this email already exists' });
        }

        const user = new User({ email, password, name: name || '' , role });
        await user.save();

        const token = generateToken(user._id);
        res.status(201).json({
            token,
            user: { id: user._id, email: user.email, name: user.name, role: user.role },
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: 'Server error during registration' });
    }
}

const login = async(req , res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = generateToken(user._id);
        res.json({
            token,
            user: { id: user._id, email: user.email, name: user.name, role: user.role },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error during login' });
    }
}

export {register , login}