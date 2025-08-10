import express from 'express';
import dotenv from 'dotenv';
import logsRouter from './routes/logsRoute.js';

dotenv.config();

const app = express();
app.use(express.json());

// Routes
app.use('/logs', logsRouter);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(process.env.PORT, () => {
  console.log(`Ingestion service running on port ${process.env.PORT}`);
});
