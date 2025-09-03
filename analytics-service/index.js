import express from "express";
import analyticsRoutes from "./routes/analyticsRoutes.js";

const app = express();

app.use(express.json());
app.use("/api", analyticsRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Analytics Service running on port ${PORT}`));
