import { AppError } from '../utils/errors.js';

export const RESULT_TYPES = Object.freeze({
  DATASET: 'dataset',
  DATASET_RESULT: 'dataset_result',
  SCALAR_RESULT: 'scalar_result',
  GROUPED_RESULT: 'grouped_result',
  SELECTED_GROUP_RESULT: 'selected_group_result',
  ROW_RESULT: 'row_result',
  SUMMARY_RESULT: 'summary_result',
  ANALYSIS_RESULT: 'analysis_result',
  ERROR: 'error',
});

const DATASET_INPUTS = new Set([
  RESULT_TYPES.DATASET,
  RESULT_TYPES.DATASET_RESULT,
  RESULT_TYPES.SELECTED_GROUP_RESULT,
]);

const TOOL_TYPES = Object.freeze({
  datasetSummary: { input: DATASET_INPUTS, output: RESULT_TYPES.SUMMARY_RESULT },
  filterData: { input: DATASET_INPUTS, output: RESULT_TYPES.DATASET_RESULT },
  aggregateData: { input: DATASET_INPUTS, output: RESULT_TYPES.SCALAR_RESULT },
  groupByAnalysis: { input: DATASET_INPUTS, output: RESULT_TYPES.GROUPED_RESULT },
  correlationAnalysis: { input: DATASET_INPUTS, output: RESULT_TYPES.ANALYSIS_RESULT },
  timeSeriesAnalysis: { input: DATASET_INPUTS, output: RESULT_TYPES.GROUPED_RESULT },
});

export function toolContract(tool) {
  return TOOL_TYPES[tool] ?? null;
}

export function resultTypeOf(result) {
  if (Array.isArray(result)) return RESULT_TYPES.DATASET;
  if (!result || typeof result !== 'object') return RESULT_TYPES.ERROR;
  if (Object.prototype.hasOwnProperty.call(result, 'rowCount')) return RESULT_TYPES.SUMMARY_RESULT;
  if (Array.isArray(result.groups)) return RESULT_TYPES.GROUPED_RESULT;
  if (Array.isArray(result.rows)) return RESULT_TYPES.DATASET_RESULT;
  if (result.row && typeof result.row === 'object') return RESULT_TYPES.ROW_RESULT;
  if (['max_group', 'min_group'].includes(result.operation) && result.group_by) return RESULT_TYPES.SELECTED_GROUP_RESULT;
  if (typeof result.value === 'number' && typeof result.operation === 'string') return RESULT_TYPES.SCALAR_RESULT;
  if (Array.isArray(result.series)) return RESULT_TYPES.GROUPED_RESULT;
  return RESULT_TYPES.ANALYSIS_RESULT;
}

export function resultOperationType(operation) {
  if (operation === 'select_group') return RESULT_TYPES.SELECTED_GROUP_RESULT;
  if (operation === 'lookup_row') return RESULT_TYPES.ROW_RESULT;
  throw new AppError(`Unknown result operation: ${operation}`, 502);
}

export function validatePlanTransitions(plan) {
  let currentType = RESULT_TYPES.DATASET;
  let hasCurrentRows = true;

  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    const next = plan[index + 1];
    if (step.operation) {
      if (step.operation === 'select_group') {
        if (currentType !== RESULT_TYPES.GROUPED_RESULT) {
          throw new AppError(`Invalid plan: select_group requires grouped_result, received ${currentType}`, 422);
        }
        currentType = resultOperationType(step.operation);
        hasCurrentRows = true;
      } else if (step.operation === 'lookup_row') {
        if (currentType !== RESULT_TYPES.SCALAR_RESULT) {
          throw new AppError(`Invalid plan: lookup_row requires scalar_result, received ${currentType}`, 422);
        }
        currentType = resultOperationType(step.operation);
      }
    } else if (step.tool === 'review') {
      if (next) throw new AppError('Invalid plan: review must be terminal', 422);
      continue;
    } else {
      const contract = toolContract(step.tool);
      if (!contract) continue;
      const previous = plan[index - 1];
      if (step.tool === 'aggregateData' && previous?.tool === 'aggregateData'
        && currentType === RESULT_TYPES.SCALAR_RESULT) {
        // A repeated aggregate reads the preserved currentRows context; it does
        // not consume the previous scalar value.
        currentType = contract.output;
        continue;
      }
      if (!contract.input.has(currentType)) {
        throw new AppError(`Invalid plan: ${currentType} cannot feed ${step.tool}`, 422);
      }
      currentType = contract.output;
      if (currentType === RESULT_TYPES.DATASET_RESULT) hasCurrentRows = true;
    }

    if (next && !hasCurrentRows && currentType !== RESULT_TYPES.SELECTED_GROUP_RESULT) {
      throw new AppError(`Invalid plan: ${currentType} is terminal and cannot feed ${next.tool ?? next.operation}`, 422);
    }
  }
}
