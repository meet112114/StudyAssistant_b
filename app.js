import express from "express";
import cors from "cors";
import authRoutes from './routes/auth.js';
import subjectRoutes from './routes/subject.js';
import resourceRoutes from './routes/resource.js';
import chatRoutes from './routes/chat.js';
import qnaRoutes from './routes/qna.js';
import adminRoutes from './routes/admin.js';
import resourcePackRoutes from './routes/resourcePack.js';
import path from 'path';

const app  = express()

app.use(cors())
const allowedOrigins = [
  process.env.FRONTEND_URL, 
  process.env.FRONTEND_DOMAIN_URL, 
  "http://localhost:3000",         
  "http://localhost:5173",        
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (Postman/mobile apps)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
  })
);


app.use(express.json());

app.get('/' , (req , res )=>{
    res.json({message:"App is running "})
})

app.use('/auth', authRoutes)
app.use('/subject', subjectRoutes)
app.use('/subjects', subjectRoutes)
app.use('/resource', resourceRoutes)
app.use('/chat', chatRoutes)
app.use('/qna', qnaRoutes)
app.use('/admin', adminRoutes)
app.use('/resource-packs', resourcePackRoutes)


app.use('/resources', express.static(path.join(process.cwd(), 'resources')));

export default app ;