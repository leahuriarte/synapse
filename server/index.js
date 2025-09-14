import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import alignRoutes from './routes/align.js';
import healthRoutes from './routes/health.js';
import graphRoutes from './routes/graphs.js';
import sessionRoutes from './routes/session.js';
import domainRoutes from './routes/domain.js';
import canvasRoutes from './routes/canvas.js';
import { initDbPragmas } from './lib/dao.js';
import hooksRoutes from './routes/hooks.js';
import fallbackRoutes from './routes/fallback.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

initDbPragmas();

app.use(express.json({ limit: '2mb' }));
app.use(alignRoutes);
app.use(canvasRoutes);
app.use(healthRoutes);
app.use(graphRoutes);
app.use(sessionRoutes);
app.use(domainRoutes);
app.use(hooksRoutes);
app.use(fallbackRoutes);

const webDir = path.resolve(__dirname, '../web');
app.use(express.static(webDir));
app.get('/', (_, res) => res.sendFile(path.join(webDir, 'index.html')));

app.listen(PORT, () => {
  console.log(`Synapse running on http://localhost:${PORT}`);
});
