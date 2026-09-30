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
  const plan = validated.plan;

  validateExplicitColumns(plan, records);
  validatePlanCompleteness(plan, question, metadata, records);

  let workingRecords = records;
  let inputRecords = records;
  let latestResult;
  const toolsUsed = [];
  const executionTrace = [];
  let selectedGroupContext;

  for (let stepIndex = 0; stepIndex < plan.length; stepIndex += 1) {
    const step = plan[stepIndex];
    const nextStep = plan[stepIndex + 1];
    if (step.operation) {
      if (step.operation === 'select_group') {
        const groupedSource = latestResult;
        const selectedGroup = selectGroup(groupedSource, step.parameters);
        latestResult = selectedGroup;
        selectedGroupContext = {
          result: groupedSource,
          selected: {
            group: selectedGroup.group,
            value: selectedGroup.value,
            count: selectedGroup.count,
            column: groupedSource.column,
            operation: selectedGroup.operation,
          },
        };
        const sourceRecords = executionTrace.at(-1)?.inputRecords;
        if (!Array.isArray(sourceRecords)) throw new AppError('select_group lost its source dataset', 422);
        workingRecords = rowsForGroup(sourceRecords, latestResult.group_by, latestResult.group);
      } else if (step.operation === 'lookup_row') {
        latestResult = lookupRow(workingRecords, latestResult, step.parameters);
      }
      executionTrace.push({
        step: executionTrace.length + 1,
        kind: 'result_operation',
        name: step.operation,
        inputType: executionTrace.at(-1)?.outputType ?? resultKind(latestResult),
        outputType: resultKind(latestResult),
        inputRecords: workingRecords,
        inputRows: Array.isArray(workingRecords) ? workingRecords.length : undefined,
      });
      continue;
    }
    if (step.tool === 'review') {
      if (toolsUsed.length === 0) throw new AppError('JEV selected review: the request is not a supported data-analysis request', 422);
      throw new AppError('JEV returned review after an executable plan step', 502);
    }
    const tool = selectionMap.get(step.tool);
    if (!tool) throw new AppError(`${step.tool} is not implemented in this checkout`, 501);
    let inferred = step.parameters ?? inferToolParameters(step.tool, question, metadata, workingRecords);
    const parameters = validateToolParameters(step.tool, inferred);
    inputRecords = workingRecords;
    latestResult = await tool.execute({ records: workingRecords, ...parameters });
    toolsUsed.push(tool.name);
    executionTrace.push({
      step: executionTrace.length + 1,
      kind: 'tool',
      name: tool.name,
      inputType: Array.isArray(inputRecords) ? 'dataset' : resultKind(inputRecords),
      outputType: resultKind(latestResult),
      inputRecords,
      inputRows: inputRecords.length,
    });
    if (nextStep) {
      if (nextStep.operation === 'select_group' || nextStep.operation === 'lookup_row') continue;
      if (!Array.isArray(latestResult?.rows)) throw new AppError(`Tool ${tool.name} did not return rows for the next plan step`, 422);
      workingRecords = latestResult.rows;
    }
  }
  if (selectedGroupContext) {
    let followUp = latestResult;
    if (latestResult === selectedGroupContext.result) {
      const followUpParameters = inferToolParameters('aggregateData', 'average performance score', metadata, workingRecords);
      followUp = await aggregateDataTool.execute({ records: workingRecords, ...followUpParameters });
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
  assertCompleteResult(question, latestResult);
  return {
    toolsUsed,
    result: latestResult,
    executionTrace: executionTrace.map(({ inputRecords, ...trace }) => trace),
  };
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
    if (next && step.tool === 'aggregateData' && next.operation !== 'lookup_row') {
      throw new AppError('A scalar aggregate result can only feed lookup_row', 422);
    }
    if (next && step.tool === 'groupByAnalysis' && next.operation !== 'select_group') {
      throw new AppError('A grouped result must be selected before another dataset tool runs', 422);
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
