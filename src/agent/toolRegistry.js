import { datasetSummaryTool } from '../tools/datasetSummary.js';
import { aggregateDataTool } from '../tools/aggregateData.js';
import { filterDataTool } from '../tools/filterData.js';
import { groupByAnalysisTool } from '../tools/groupByAnalysis.js';
import { correlationAnalysisTool } from '../tools/correlationAnalysis.js';
import { timeSeriesAnalysisTool } from '../tools/timeSeriesAnalysis.js';
import { AppError } from '../utils/errors.js';
import { validateToolDecision, ALLOWED_JEV_TOOLS } from '../services/decisionValidator.js';
import { inferToolParameters } from '../services/toolParameterService.js';

const activeTools = [
  datasetSummaryTool,
  aggregateDataTool,
  filterDataTool,
  groupByAnalysisTool,
  correlationAnalysisTool,
  timeSeriesAnalysisTool,
];
const toolMap = new Map(activeTools.map((tool) => [tool.name, tool]));
const selectionMap = new Map([
  ['datasetSummary', datasetSummaryTool],
  ['filterData', filterDataTool],
  ['aggregateData', aggregateDataTool],
  ['correlationAnalysis', correlationAnalysisTool],
  ['regressionAnalysis', null],
  ['timeSeriesAnalysis', timeSeriesAnalysisTool],
]);

export function getJevToolDescriptions() {
  return ALLOWED_JEV_TOOLS.map((name) => ({
    name,
    description: name === 'review'
      ? 'Use when the request is not a supported data analysis or asks for an external action.'
      : selectionMap.get(name)?.description ?? 'Regression analysis is not implemented in this checkout.',
  }));
}

export function getToolDeclarations() {
  return activeTools.map((tool) => tool.declaration);
}

export async function executeTool(name, args, context) {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`Tool is not registered: ${name}`);
  return tool.execute({ ...args, ...context });
}

export function isRegisteredTool(name) {
  return toolMap.has(name);
}

export async function dispatchToolSelection(decision, { records, question, metadata }) {
  const validated = validateToolDecision(decision);
  if (validated.tool === 'review') throw new AppError('JEV selected review: the request is not a supported data-analysis request', 422);
  const tool = selectionMap.get(validated.tool);
  if (!tool) throw new AppError(`${validated.tool} is not implemented in this checkout`, 501);
  const parameters = validated.parameters ?? inferToolParameters(validated.tool, question, metadata);
  const result = await tool.execute({ records, ...parameters });
  return { toolName: tool.name, result };
}
