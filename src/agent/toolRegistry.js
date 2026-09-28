import { datasetSummaryTool } from '../tools/datasetSummary.js';
import { aggregateDataTool } from '../tools/aggregateData.js';
import { filterDataTool } from '../tools/filterData.js';
import { groupByAnalysisTool } from '../tools/groupByAnalysis.js';
import { correlationAnalysisTool } from '../tools/correlationAnalysis.js';
import { timeSeriesAnalysisTool } from '../tools/timeSeriesAnalysis.js';

const activeTools = [
  datasetSummaryTool,
  aggregateDataTool,
  filterDataTool,
  groupByAnalysisTool,
  correlationAnalysisTool,
  timeSeriesAnalysisTool,
];
const toolMap = new Map(activeTools.map((tool) => [tool.name, tool]));

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
