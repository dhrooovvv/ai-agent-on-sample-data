import { datasetSummaryTool } from '../tools/datasetSummary.js';
import { aggregateDataTool } from '../tools/aggregateData.js';
import { filterDataTool } from '../tools/filterData.js';
import { groupByAnalysisTool } from '../tools/groupByAnalysis.js';
import { correlationAnalysisTool } from '../tools/correlationAnalysis.js';
import { timeSeriesAnalysisTool } from '../tools/timeSeriesAnalysis.js';
import { AppError } from '../utils/errors.js';
import { normalizeToolPlan, validateToolParameters, ALLOWED_JEV_TOOLS } from '../services/decisionValidator.js';
import { inferToolParameters } from '../services/toolParameterService.js';
import { questionRequestsRow } from '../services/rowLookupService.js';
import { questionRequestsGroupedPerformance, rowsForGroup } from '../services/groupFollowUpService.js';
import { lookupRow, resultKind, selectGroup } from '../services/resultOperations.js';
import { RESULT_TYPES, resultTypeOf, validatePlanTransitions } from '../services/executionTypes.js';

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
  ['groupByAnalysis', groupByAnalysisTool],
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
  const dispatched = await dispatchToolPlan(decision, { records, question, metadata });
  return { toolName: dispatched.toolsUsed[0], result: dispatched.result };
}

export async function dispatchToolPlan(decision, { records, question, metadata }) {
  const validated = normalizeToolPlan(decision);
  const plan = completeResultOperations(validated.plan, question);

  validateExplicitColumns(plan, records);
  validatePlanTransitions(plan);
  validatePlanCompleteness(plan, question, metadata, records);

  const context = {
    originalRows: records,
    currentRows: records,
    lastResult: undefined,
    resultType: RESULT_TYPES.DATASET,
  };
  const toolsUsed = [];
  const executionTrace = [];
  const aggregateResults = [];
  let selectedGroupContext;

  for (let stepIndex = 0; stepIndex < plan.length; stepIndex += 1) {
    const step = plan[stepIndex];
    if (step.operation) {
      if (step.operation === 'select_group') {
        const groupedSource = context.lastResult;
        const selectedGroup = selectGroup(groupedSource, step.parameters);
        context.lastResult = selectedGroup;
        context.resultType = resultTypeOf(selectedGroup);
        selectedGroupContext = {
          result: groupedSource,
          selected: {
            group: selectedGroup.group,
            value: selectedGroup.value,
            count: selectedGroup.count,
            column: groupedSource.column,
            aggregation_operation: groupedSource.operation,
            operation: selectedGroup.operation,
          },
        };
        context.currentRows = rowsForGroup(context.currentRows, selectedGroup.group_by, selectedGroup.group);
      } else if (step.operation === 'lookup_row') {
        context.lastResult = lookupRow(context.currentRows, context.lastResult, step.parameters);
        context.resultType = resultTypeOf(context.lastResult);
      }
      executionTrace.push({
        step: executionTrace.length + 1,
        kind: 'result_operation',
        name: step.operation,
        inputType: executionTrace.at(-1)?.outputType ?? context.resultType,
        outputType: context.resultType,
        inputRows: context.currentRows.length,
      });
      continue;
    }
    if (step.tool === 'review') {
      if (toolsUsed.length === 0) throw new AppError('JEV selected review: the request is not a supported data-analysis request', 422);
      throw new AppError('JEV returned review after an executable plan step', 502);
    }
    const tool = selectionMap.get(step.tool);
    if (!tool) throw new AppError(`${step.tool} is not implemented in this checkout`, 501);
    const excludedAggregateColumns = step.tool === 'aggregateData'
      ? [
        ...aggregateResults.map((result) => result.column),
        selectedGroupContext?.selected.column,
      ].filter(Boolean)
      : [];
    let inferred = step.parameters ?? inferToolParameters(
      step.tool,
      question,
      metadata,
      context.currentRows,
      { excludeColumns: excludedAggregateColumns },
    );
    const parameters = validateToolParameters(step.tool, inferred);
    const inputRecords = context.currentRows;
    context.lastResult = await tool.execute({ records: inputRecords, ...parameters });
    context.resultType = resultTypeOf(context.lastResult);
    if (step.tool === 'aggregateData') aggregateResults.push(context.lastResult);
    toolsUsed.push(tool.name);
    executionTrace.push({
      step: executionTrace.length + 1,
      kind: 'tool',
      name: tool.name,
      inputType: Array.isArray(inputRecords) ? 'dataset' : resultKind(inputRecords),
      outputType: context.resultType,
      inputRecords,
      inputRows: inputRecords.length,
    });
    if (context.resultType === RESULT_TYPES.DATASET_RESULT) {
      context.currentRows = context.lastResult.rows;
    }
  }
  let latestResult = context.lastResult;
  if (selectedGroupContext) {
    if (context.resultType === RESULT_TYPES.SELECTED_GROUP_RESULT) {
      latestResult = {
        operation: selectedGroupContext.selected.operation,
        group_by: selectedGroupContext.result.group_by,
        group: selectedGroupContext.selected.group,
        column: selectedGroupContext.selected.column,
        aggregation_operation: selectedGroupContext.selected.aggregation_operation,
        value: selectedGroupContext.selected.value,
        count: selectedGroupContext.selected.count,
      };
    } else {
    let followUp = latestResult;
    if (latestResult === selectedGroupContext.result) {
      const followUpParameters = inferToolParameters('aggregateData', 'average performance score', metadata, context.currentRows);
      followUp = await aggregateDataTool.execute({ records: context.currentRows, ...followUpParameters });
      toolsUsed.push(aggregateDataTool.name);
    }
    latestResult = {
      operation: selectedGroupContext.selected.operation === 'min_group' ? 'group_min_follow_up' : 'group_max_follow_up',
      group_by: selectedGroupContext.result.group_by,
      group: selectedGroupContext.selected.group,
      primary: selectedGroupContext.selected,
      follow_up: followUp,
    };
    }
  }
  if (aggregateResults.length > 1 && context.resultType === RESULT_TYPES.SCALAR_RESULT) {
    latestResult = { operation: 'multi_aggregate', results: aggregateResults };
  }
  assertCompleteResult(question, latestResult);
  return {
    toolsUsed,
    result: latestResult,
    executionTrace: executionTrace.map(({ inputRecords, ...trace }) => trace),
  };
}

function questionRequestsGroupSelection(question) {
  const text = String(question).toLowerCase();
  return /\b(highest|lowest|top|bottom|maximum|minimum)\b/.test(text)
    && /\b(by|per|group|department|region|category|team)\b/.test(text);
}

function completeResultOperations(plan, question) {
  let completed = [...plan];
  const requestedAggregationCount = (String(question).match(/\b(sum|total|average|avg|mean|maximum|max|highest|minimum|min|lowest|count)\b/gi) ?? []).length;
  if (!questionRequestsGroupSelection(question)) {
    let aggregateSeen = 0;
    completed = completed.filter((step) => {
      if (step.tool !== 'aggregateData') return true;
      aggregateSeen += 1;
      return aggregateSeen <= Math.max(1, requestedAggregationCount);
    });
  }
  const rowRequest = questionRequestsRow(question, { operation: 'max' })
    && /\b(maximum|max|highest|minimum|min|lowest)\b/i.test(question)
    && !questionRequestsGroupSelection(question);
  if (rowRequest) {
    const aggregateIndex = completed.findIndex((step) => step.tool === 'aggregateData');
    if (aggregateIndex >= 0) {
      // A requested related metric belongs to the matching row, not to a
      // second scalar aggregation that would lose the max-column identity.
      completed = completed.filter((step, index) => step.tool !== 'aggregateData' || index === aggregateIndex);
      if (!completed.some((step) => step.operation === 'lookup_row')) {
        completed.push({ operation: 'lookup_row', parameters: { selection: /\b(minimum|min|lowest)\b/i.test(question) ? 'min' : 'max' } });
      }
    }
  }

  if (questionRequestsGroupSelection(question)) {
    const groupIndex = completed.findIndex((step) => step.tool === 'groupByAnalysis');
    if (groupIndex >= 0) {
      const next = completed[groupIndex + 1];
      if (next?.tool === 'groupByAnalysis') completed[groupIndex + 1] = { operation: 'select_group', parameters: { selection: /\b(lowest|minimum|bottom)\b/i.test(question) ? 'min' : 'max' } };
      if (!completed.some((step) => step.operation === 'select_group')) {
        completed.splice(groupIndex + 1, 0, { operation: 'select_group', parameters: { selection: /\b(lowest|minimum|bottom)\b/i.test(question) ? 'min' : 'max' } });
      }
      if (questionRequestsGroupedPerformance(question)) {
        const selectIndex = completed.findIndex((step) => step.operation === 'select_group');
        if (!completed.some((step, index) => step.tool === 'aggregateData' && index > selectIndex)) {
          completed.push({ tool: 'aggregateData' });
        }
      }
    }
  }
  if (completed.length > 8) throw new AppError('Execution plan exceeds the supported step limit', 422);
  return completed;
}

function validatePlanCompleteness(plan, question, metadata, records) {
  const toolNames = new Set(plan.filter((step) => step.tool).map((step) => step.tool));
  const hasAnalysis = ['aggregateData', 'groupByAnalysis', 'correlationAnalysis', 'regressionAnalysis', 'timeSeriesAnalysis']
    .some((tool) => toolNames.has(tool));
  if (hasAnalysis && !toolNames.has('filterData')) {
    try {
      inferToolParameters('filterData', question, metadata, records);
      throw new AppError('Execution plan is incomplete: filterData is required by the request', 422);
    } catch (error) {
      if (!(error instanceof AppError) || error.message.includes('required by the request')) throw error;
    }
  }
  if (questionRequestsGroupedPerformance(question) && !toolNames.has('groupByAnalysis')) {
    throw new AppError('Execution plan is incomplete: groupByAnalysis is required by the request', 422);
  }
  if (questionRequestsGroupedPerformance(question) && !plan.some((step) => step.operation === 'select_group')) {
    throw new AppError('Execution plan is incomplete: select_group is required to choose the requested group', 422);
  }
  const selectIndex = plan.findIndex((step) => step.operation === 'select_group');
  const followUpAggregateIndex = plan.findIndex((step, index) => step.tool === 'aggregateData' && index > selectIndex);
  if (questionRequestsGroupedPerformance(question) && followUpAggregateIndex === -1) {
    throw new AppError('Execution plan is incomplete: aggregateData is required for the requested follow-up metric', 422);
  }
  if (toolNames.has('aggregateData')
    && !toolNames.has('groupByAnalysis')
    && /\b(maximum|max|highest|minimum|min|lowest)\b/i.test(question)
    && questionRequestsRow(question, { operation: 'max' })
    && !plan.some((step, index) => step.operation === 'lookup_row' && index > plan.findIndex((candidate) => candidate.tool === 'aggregateData'))) {
    throw new AppError('Execution plan is incomplete: lookup_row is required to return the requested row', 422);
  }
}

function validateExplicitColumns(plan, records) {
  const columns = new Set(records.flatMap((record) => Object.keys(record)));
  for (const step of plan) {
    if (!step.tool || !step.parameters) continue;
    const parameters = step.parameters;
    const referenced = [];
    if (step.tool === 'aggregateData' && parameters.column) referenced.push(parameters.column);
    if (step.tool === 'filterData') referenced.push(...(parameters.conditions ?? []).map((condition) => condition.column));
    if (step.tool === 'correlationAnalysis') referenced.push(parameters.column_x, parameters.column_y);
    if (step.tool === 'groupByAnalysis') referenced.push(parameters.group_by, parameters.column);
    if (step.tool === 'timeSeriesAnalysis') referenced.push(parameters.date_column, parameters.value_column);
    for (const column of referenced.filter(Boolean)) {
      if (!columns.has(column)) throw new AppError(`Column does not exist: ${column}`, 422);
    }
  }
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    const previous = plan[index - 1];
    const next = plan[index + 1];
    if (step.operation === 'select_group' && previous?.tool !== 'groupByAnalysis') {
      throw new AppError('select_group must consume a grouped result', 422);
    }
    if (step.operation === 'lookup_row' && previous?.tool !== 'aggregateData') {
      throw new AppError('lookup_row must consume a scalar aggregate result', 422);
    }
    if (next && step.operation === 'lookup_row') {
      throw new AppError('lookup_row must be the final result operation', 422);
    }
  }
}

function assertCompleteResult(question = '', result) {
  const normalized = String(question).toLowerCase();
  if (result?.rows && /\b(average|mean|sum|total|minimum|maximum|max|min|count)\b/.test(normalized)) {
    throw new AppError('Execution stopped before the requested aggregation was completed', 422);
  }
  if (result?.groups && /\b(highest|lowest|top|bottom|maximum|min(?:imum)?)\b/.test(normalized)) {
    throw new AppError('Execution stopped before the requested group comparison was completed', 422);
  }
  if (result?.operation && ['min', 'max'].includes(result.operation)
    && /\b(who|which|person|name|their|row|record)\b/.test(normalized)) {
    throw new AppError('Execution stopped before the requested row lookup was completed', 422);
  }
}
