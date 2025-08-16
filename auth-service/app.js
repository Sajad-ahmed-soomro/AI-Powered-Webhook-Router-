import express from 'express';
import authRoutes from './routes/authRoutes.js'
import dotenv from 'dotenv';
import requireAuth from './middleware/auth.js';

dotenv.config();

const app=express();

app.use(express.json());

app.use("/auth",authRoutes);

app.get("/profile", requireAuth, (req, res) => {
    res.json({ message: `Welcome ${req.user.username}` });
});


app.listen(process.env.PORT,()=>{
    console.log(`Auth Server is listening at: ${process.env.PORT}`);
});