import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Skyland Command Center API running on port ${PORT}`);
});
