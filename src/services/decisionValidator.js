import { AppError } from '../utils/errors.js';

export const ALLOWED_JEV_TOOLS = [
  'datasetSummary',
  'filterData',
  'aggregateData',
  'groupByAnalysis',
  'correlationAnalysis',
  'regressionAnalysis',
  'timeSeriesAnalysis',
  'review',
];

export const ALLOWED_RESULT_OPERATIONS = [
  'select_group',
  'lookup_row',
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

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertKeys(parameters, allowed, tool) {
  for (const key of Object.keys(parameters)) {
    if (!allowed.includes(key)) throw new AppError(`Unexpected parameter for ${tool}: ${key}`, 502);
  }
}

export function validateToolParameters(tool, parameters = {}) {
  if (!plainObject(parameters)) throw new AppError(`Malformed parameters for ${tool}`, 502);
  if (tool === 'datasetSummary' || tool === 'review' || tool === 'regressionAnalysis') {
    assertKeys(parameters, [], tool);
    return parameters;
  }
  if (tool === 'aggregateData') {
    assertKeys(parameters, ['operation', 'column'], tool);
    if (typeof parameters.operation !== 'string') throw new AppError('aggregateData requires an operation', 502);
    if (parameters.column !== undefined && typeof parameters.column !== 'string') throw new AppError('aggregateData column must be a string', 502);
  }
  if (tool === 'filterData') {
    assertKeys(parameters, ['conditions', 'condition', 'logic'], tool);
    if (parameters.logic !== undefined && !['and', 'or'].includes(String(parameters.logic).toLowerCase())) {
      throw new AppError('filterData logic must be AND or OR', 502);
    }
    const conditions = parameters.conditions ?? (parameters.condition ? [parameters.condition] : undefined);
    if (!Array.isArray(conditions) || conditions.length === 0) throw new AppError('filterData requires conditions', 502);
    for (const condition of conditions) {
      if (!plainObject(condition) || typeof condition.column !== 'string' || typeof condition.operator !== 'string' || condition.value === undefined) {
        throw new AppError('Malformed filterData condition', 502);
      }
    }
  }
  if (tool === 'correlationAnalysis') {
    assertKeys(parameters, ['column_x', 'column_y'], tool);
    if (typeof parameters.column_x !== 'string' || typeof parameters.column_y !== 'string') throw new AppError('correlationAnalysis requires two columns', 502);
  }
  if (tool === 'groupByAnalysis') {
    assertKeys(parameters, ['group_by', 'operation', 'column'], tool);
    if (typeof parameters.group_by !== 'string' || typeof parameters.operation !== 'string') {
      throw new AppError('groupByAnalysis requires group_by and operation', 502);
    }
    if (parameters.column !== undefined && typeof parameters.column !== 'string') throw new AppError('groupByAnalysis column must be a string', 502);
  }
  if (tool === 'timeSeriesAnalysis') {
    assertKeys(parameters, ['date_column', 'value_column', 'operation', 'granularity'], tool);
    for (const key of ['date_column', 'value_column', 'operation']) {
      if (typeof parameters[key] !== 'string') throw new AppError(`timeSeriesAnalysis requires ${key}`, 502);
    }
    if (parameters.granularity !== undefined && typeof parameters.granularity !== 'string') throw new AppError('timeSeriesAnalysis granularity must be a string', 502);
  }
  return parameters;
}

export function validateToolPlan(decision) {
  if (!plainObject(decision) || !Array.isArray(decision.plan) || decision.plan.length === 0 || decision.plan.length > 8) {
    throw new AppError('JEV returned a malformed tool plan', 502);
  }
  return {
    plan: decision.plan.map((step) => {
      if (!plainObject(step)) throw new AppError('JEV returned a malformed plan step', 502);
      if (typeof step.operation === 'string') {
        if (!ALLOWED_RESULT_OPERATIONS.includes(step.operation)) {
          throw new AppError(`JEV returned an invalid result operation: ${step.operation}`, 502);
        }
        const parameters = step.parameters ?? {};
        if (!plainObject(parameters)) throw new AppError(`Malformed parameters for ${step.operation}`, 502);
        if (step.operation === 'select_group') {
          assertKeys(parameters, ['selection'], step.operation);
          if (!['max', 'min', 'highest', 'lowest', 'top', 'bottom'].includes(parameters.selection)) {
            throw new AppError('select_group requires a supported selection', 502);
          }
        }
        if (step.operation === 'lookup_row') {
          assertKeys(parameters, ['column', 'selection'], step.operation);
          if (parameters.column !== undefined && typeof parameters.column !== 'string') {
            throw new AppError('lookup_row column must be a string', 502);
          }
          if (parameters.selection !== undefined && !['max', 'min', 'highest', 'lowest'].includes(parameters.selection)) {
            throw new AppError('lookup_row requires a supported selection', 502);
          }
        }
        return { operation: step.operation, parameters };
      }
      const validated = validateToolDecision({ tool: step.tool, parameters: step.parameters });
      if (step.parameters === undefined) return { tool: validated.tool };
      return { tool: validated.tool, parameters: validateToolParameters(validated.tool, step.parameters) };
    }),
  };
}

export function normalizeToolPlan(decision) {
  if (plainObject(decision) && Array.isArray(decision.plan)) return validateToolPlan(decision);
  const validated = validateToolDecision(decision);
  const step = { tool: validated.tool };
  if (validated.parameters !== undefined) step.parameters = validateToolParameters(validated.tool, validated.parameters);
  return { plan: [step] };
}
