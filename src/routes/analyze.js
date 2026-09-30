import { Router } from 'express';
import multer from 'multer';
import { parseCsvBuffer } from '../services/csvService.js';
import { validateQuestion } from '../services/validationService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createAnalyzeRouter(agentService) {
  const router = Router();
  router.post('/', upload.single('file'), async (request, response, next) => {
    try {
      const question = validateQuestion(request.body.question);
      const records = parseCsvBuffer(request.file?.buffer);
      const result = await agentService.analyze({ question, records });
      response.json({
        success: true,
        question,
        answer: result.answer,
        result: result.result,
        tools_used: result.toolsUsed,
        execution_trace: result.executionTrace,
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
