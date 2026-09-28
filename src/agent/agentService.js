import { GoogleGenAI } from '@google/genai';
import { getToolDeclarations, executeTool, isRegisteredTool } from './toolRegistry.js';
import { SYSTEM_PROMPT } from './prompts.js';
import { AppError } from '../utils/errors.js';

function toPublicResult(summary) {
  if (!summary) return undefined;
  if (Object.prototype.hasOwnProperty.call(summary, 'rowCount')) {
    return { rows: summary.rowCount, columns: summary.columnCount, column_names: summary.columnNames };
  }
  return summary;
}

function answerFromToolResult(result, fallbackText) {
  if (!result) return fallbackText;
  if (Object.prototype.hasOwnProperty.call(result, 'rowCount')) {
    return `The dataset contains ${result.rowCount} rows and ${result.columnCount} columns.`;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'operation')) {
    if (result.operation === 'count') return `The dataset contains ${result.value} records.`;
    if (result.operation && result.column) return `The ${result.operation} of ${result.column} is ${result.value}.`;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'matched_rows')) {
    return `The filter matched ${result.matched_rows} of ${result.total_rows} rows.`;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'groups')) {
    return `The grouped analysis returned ${result.groups.length} groups.`;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'correlation')) {
    return result.correlation === null
      ? 'The correlation is undefined because one column has no variance.'
      : `The Pearson correlation is ${result.correlation}.`;
  }
  if (Object.prototype.hasOwnProperty.call(result, 'series')) {
    return `The time-series analysis returned ${result.series.length} periods.`;
  }
  return fallbackText;
}

export function createAgentService({ apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL ?? 'gemini-3.7-flash', client } = {}) {
  if (!apiKey && !client) throw new AppError('GEMINI_API_KEY is not configured', 500);
  const ai = client ?? new GoogleGenAI({ apiKey });

  return {
    async analyze({ question, records }) {
      let contents = [{ role: 'user', parts: [{ text: question }] }];
      const toolsUsed = [];
      let latestToolResult;

      for (let turn = 0; turn < 5; turn += 1) {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: { systemInstruction: SYSTEM_PROMPT, tools: [{ functionDeclarations: getToolDeclarations() }] },
        });
        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const functionCalls = parts.filter((part) => part.functionCall);
        if (!functionCalls.length) {
          const fallbackText = parts.filter((part) => part.text).map((part) => part.text).join('\n').trim();
          const answer = answerFromToolResult(latestToolResult, fallbackText);
          return { answer, result: toPublicResult(latestToolResult), toolsUsed };
        }

        contents = [...contents, { role: 'model', parts }];
        const functionResponses = [];
        for (const part of functionCalls) {
          const { name, args = {} } = part.functionCall;
          if (!isRegisteredTool(name)) throw new AppError(`Gemini requested unavailable tool: ${name}`, 500);
          const result = await executeTool(name, args, { records });
          latestToolResult = result;
          if (!toolsUsed.includes(name)) toolsUsed.push(name);
          functionResponses.push({ functionResponse: { name, response: { result } } });
        }
        contents.push({ role: 'user', parts: functionResponses });
      }
      throw new AppError('Gemini exceeded the tool-call limit', 500);
    },
  };
}
