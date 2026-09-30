import { AppError } from '../utils/errors.js';
import { validateToolDecision, validateToolPlan } from './decisionValidator.js';

const DEFAULT_BASE_URL = 'https://api.codiv.ai';
const DEFAULT_MODEL = 'openjev-latest';

export function createJevService({
  apiKey = process.env.TYPESAFE_API_KEY,
  baseUrl = process.env.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL,
  model = process.env.TYPESAFE_MODEL ?? DEFAULT_MODEL,
  fetchImpl = fetch,
} = {}) {
  async function requestJev({ userRequest, dataset, availableTools, questions }) {
    if (!apiKey) throw new AppError('TYPESAFE_API_KEY is not configured', 500);
    const payload = {
      model,
      state: { userRequest, dataset, availableTools },
      questions,
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
    try {
      return await response.json();
    } catch {
      throw new AppError('JEV returned invalid JSON', 502);
    }
  }

  function criteriaFor(availableTools) {
    return Object.fromEntries(availableTools.map(({ name, description }) => [name, description]));
  }

  function readPlan(body) {
    if (body?.answers?.plan?.choice) {
      const choice = body.answers.plan.choice;
      if (typeof choice === 'object') return validateToolPlan(choice);
      if (typeof choice === 'string') {
        try {
          return validateToolPlan(JSON.parse(choice));
        } catch {
          return validateToolPlan({ plan: [{ tool: choice }] });
        }
      }
    }
    const steps = [];
    for (let index = 1; index <= 8; index += 1) {
      const choice = body?.answers?.[`step_${index}`]?.choice;
      if (typeof choice !== 'string') break;
      if (choice === 'review') {
        if (index === 1) steps.push({ tool: 'review' });
        break;
      }
      steps.push({ tool: choice });
    }
    if (steps.length) return validateToolPlan({ plan: steps });
    throw new AppError('JEV returned no tool plan', 502);
  }

  return {
    async choosePlan({ userRequest, dataset, availableTools }) {
      const criteria = criteriaFor(availableTools);
      const questions = {};
      for (let index = 1; index <= 8; index += 1) {
        questions[`step_${index}`] = {
          type: 'choice',
          instructions: index === 1
            ? 'Choose the first step in a complete execution plan. Include filterData for every row constraint before analysis. Do not stop at an intermediate operation.'
            : 'Choose the next step in the complete plan. Preserve every prior filter, and include grouping, aggregation, comparison, or row lookup stages needed to answer every part of the request. Choose review only for unsupported requests or after the complete plan is represented.',
          criteria,
        };
      }
      return readPlan(await requestJev({ userRequest, dataset, availableTools, questions }));
    },
    async chooseTool({ userRequest, dataset, availableTools }) {
      const body = await requestJev({ userRequest, dataset, availableTools, questions: {
        tool: {
          type: 'choice',
          instructions: 'Choose exactly one available analysis tool for the user request. Choose review when the request is unsupported.',
          criteria: criteriaFor(availableTools),
        },
      } });
      const choice = body?.answers?.tool?.choice;
      return validateToolDecision({ tool: choice });
    },
  };
}

export { DEFAULT_BASE_URL, DEFAULT_MODEL };
