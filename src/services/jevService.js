import { AppError } from '../utils/errors.js';
import { validateToolDecision } from './decisionValidator.js';

const DEFAULT_BASE_URL = 'https://api.codiv.ai';
const DEFAULT_MODEL = 'openjev-latest';

export function createJevService({
  apiKey = process.env.TYPESAFE_API_KEY,
  baseUrl = process.env.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL,
  model = process.env.TYPESAFE_MODEL ?? DEFAULT_MODEL,
  fetchImpl = fetch,
} = {}) {
  return {
    async chooseTool({ userRequest, dataset, availableTools }) {
      if (!apiKey) throw new AppError('TYPESAFE_API_KEY is not configured', 500);
      const payload = {
        model,
        state: { userRequest, dataset, availableTools },
        questions: {
          tool: {
            type: 'choice',
            instructions: 'Choose exactly one available analysis tool for the user request. Choose review when the request does not clearly match an available analysis tool or asks for an external action.',
            criteria: Object.fromEntries(availableTools.map(({ name, description }) => [name, description])),
          },
        },
      };

      let response;
      try {
        response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/systemone`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw new AppError(`JEV request failed: ${error.message}`, 502);
      }
      if (!response.ok) throw new AppError(`JEV request failed with status ${response.status}`, 502);

      let body;
      try {
        body = await response.json();
      } catch {
        throw new AppError('JEV returned invalid JSON', 502);
      }
      const choice = body?.answers?.tool?.choice;
      return validateToolDecision({ tool: choice });
    },
  };
}

export { DEFAULT_BASE_URL, DEFAULT_MODEL };
