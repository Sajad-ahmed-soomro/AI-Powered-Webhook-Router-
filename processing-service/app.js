import express from 'express';
const app = express();
app.use(express.json());

import retryRoutes from './routes/retryRoutes.js';

app.use('/', retryRoutes);


app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });
  


app.get('/health', (req, res) => res.json({ status: 'ok' }));
export default app;
