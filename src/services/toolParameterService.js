import { AppError } from '../utils/errors.js';

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mentionedColumns(request, columns) {
  return columns
    .map((column) => ({ ...column, position: request.toLowerCase().indexOf(column.name.toLowerCase()) }))
    .filter((column) => column.position >= 0)
    .sort((left, right) => left.position - right.position);
}

function firstColumn(request, columns, predicate = () => true) {
  const column = mentionedColumns(request, columns).find(predicate);
  if (!column) throw new AppError('JEV selected a tool but the request does not identify the required dataset column', 422);
  return column.name;
}

function operationFromRequest(request, allowed, fallback) {
  const text = request.toLowerCase();
  if (/\b(count|how many|number of)\b/.test(text) && allowed.includes('count')) return 'count';
  if (/\b(average|avg|mean)\b/.test(text) && allowed.includes('average')) return 'average';
  if (/\b(total|sum)\b/.test(text) && allowed.includes('sum')) return 'sum';
  if (/\b(maximum|max|highest)\b/.test(text) && allowed.includes('max')) return 'max';
  if (/\b(minimum|min|lowest)\b/.test(text) && allowed.includes('min')) return 'min';
  return fallback;
}

function parseFilterValue(value) {
  const numeric = numericValue(value);
  const cleaned = value.trim().replace(/[?.!,;]+$/, '').replace(/^['"]|['"]$/g, '');
  const cleanedNumeric = numericValue(cleaned);
  return cleanedNumeric === null ? cleaned : cleanedNumeric;
}

function filterArguments(request, columns) {
  const lower = request.toLowerCase();
  const column = firstColumn(request, columns);
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`${escaped}\\s*(=|!=|>=|<=|>|<)\\s*([^,;]+)`, 'i');
  const textualExpression = new RegExp(`${escaped}\\s+(?:is|equals?)\\s+([^,;]+)`, 'i');
  const betweenExpression = new RegExp(`${escaped}\\s+between\\s+([^\\s,;]+)\\s+and\\s+([^,;]+)`, 'i');
  const aboveBelow = new RegExp(`(?:above|over|greater than|at least|below|under|less than|at most)\\s+([^,;]+)`, 'i');
  const between = lower.match(betweenExpression);
  if (between) return { conditions: [{ column, operator: 'between', value: [parseFilterValue(between[1]), parseFilterValue(between[2])] }] };
  const match = request.match(expression);
  if (match) return { conditions: [{ column, operator: match[1], value: parseFilterValue(match[2]) }] };
  const textual = request.match(textualExpression);
  if (textual) return { conditions: [{ column, operator: '=', value: parseFilterValue(textual[1]) }] };
  const direction = lower.match(aboveBelow);
  if (direction) {
    const operator = /\b(above|over|greater than|at least)\b/.test(lower) ? (lower.includes('at least') ? '>=' : '>') : (lower.includes('at most') ? '<=' : '<');
    return { conditions: [{ column, operator, value: parseFilterValue(direction[1]) }] };
  }
  throw new AppError('Could not determine the filter condition from the request', 422);
}

export function inferToolParameters(tool, request, metadata) {
  const columns = metadata.columns;
  const numericColumns = columns.filter((column) => column.type === 'number');
  const dateColumns = columns.filter((column) => column.type === 'date');
  if (tool === 'datasetSummary') return {};
  if (tool === 'filterData') return filterArguments(request, columns);
  if (tool === 'aggregateData') {
    const operation = operationFromRequest(request, ['sum', 'average', 'min', 'max', 'count'], 'average');
    return { operation, column: operation === 'count' ? undefined : firstColumn(request, numericColumns, () => true) };
  }
  if (tool === 'correlationAnalysis') {
    const matches = mentionedColumns(request, numericColumns);
    if (matches.length < 2) throw new AppError('Correlation requires two referenced numeric columns', 422);
    return { column_x: matches[0].name, column_y: matches[1].name };
  }
  if (tool === 'timeSeriesAnalysis') {
    const dateColumn = mentionedColumns(request, dateColumns)[0]?.name ?? dateColumns[0]?.name;
    if (!dateColumn) throw new AppError('Time-series analysis requires a date/time column', 422);
    const valueColumn = firstColumn(request, numericColumns, () => true);
    const operation = operationFromRequest(request, ['sum', 'average', 'min', 'max', 'count'], 'sum');
    const granularity = /\b(day|daily|date)\b/i.test(request) ? 'day' : 'month';
    return { date_column: dateColumn, value_column: valueColumn, operation, granularity };
  }
  if (tool === 'regressionAnalysis') return {};
  throw new AppError(`No parameter resolver exists for ${tool}`, 422);
}
