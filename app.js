import express from "express";
import cors from "cors";
import authRoutes from './routes/auth.js';
import subjectRoutes from './routes/subject.js';
import resourceRoutes from './routes/resource.js';
import chatRoutes from './routes/chat.js';
import qnaRoutes from './routes/qna.js';
import path from 'path';

const app  = express()

app.use(cors())
app.use(express.json())

app.get('/' , (req , res )=>{
    res.json({message:"App is running "})
})

app.use('/auth', authRoutes)
app.use('/subject', subjectRoutes)
app.use('/subjects', subjectRoutes)
app.use('/resource', resourceRoutes)
app.use('/chat', chatRoutes)
app.use('/qna', qnaRoutes)


app.use('/resources', express.static(path.join(process.cwd(), 'resources')));

export default app ;