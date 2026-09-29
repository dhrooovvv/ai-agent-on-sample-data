import { AppError } from '../utils/errors.js';

export const ALLOWED_JEV_TOOLS = [
  'datasetSummary',
  'filterData',
  'aggregateData',
  'correlationAnalysis',
  'regressionAnalysis',
  'timeSeriesAnalysis',
  'review',
];

export function validateToolDecision(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new AppError('JEV returned a malformed tool decision', 502);
  }
  if (typeof decision.tool !== 'string' || !ALLOWED_JEV_TOOLS.includes(decision.tool)) {
    throw new AppError('JEV returned an invalid tool decision', 502);
  }
  if (decision.parameters !== undefined && (typeof decision.parameters !== 'object' || Array.isArray(decision.parameters))) {
    throw new AppError('JEV returned malformed tool parameters', 502);
  }
  return decision;
}
