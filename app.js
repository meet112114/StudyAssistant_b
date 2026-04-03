import express from "express";
import cors from "cors";
import authRoutes from './routes/auth.js';
const app  = express()

app.use(cors())
app.use(express.json())

app.get('/' , (req , res )=>{
    res.json({message:"App is running "})
})

app.use('/auth',authRoutes)

export default app ;