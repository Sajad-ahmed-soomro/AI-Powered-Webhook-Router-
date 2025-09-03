import express from 'express';
import dotenv from 'dotenv';
// import { startQueueConsumer } from './services/queueService.js';

import routerRoutes from './routes/routerRoutes.js'

dotenv.config();
const app = express();
app.use(express.json());

app.use("/api/router-service",routerRoutes);


app.get('/health', (req, res) => {
  res.json({ status: 'Router Service running' });
});

app.listen(process.env.PORT, () => {
  console.log(`Router service running on port ${process.env.PORT}`);
  // startQueueConsumer();
});
