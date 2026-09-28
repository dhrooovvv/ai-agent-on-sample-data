import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAgentService } from './agent/agentService.js';
import { createAnalyzeRouter } from './routes/analyze.js';
import { errorHandler } from './utils/errors.js';

export function createApp({ agentService = createAgentService() } = {}) {
  const app = express();
  app.use(express.json());
  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.use('/analyze', createAnalyzeRouter(agentService));
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => console.log(`JS data-analysis agent listening on port ${port}`));
}
