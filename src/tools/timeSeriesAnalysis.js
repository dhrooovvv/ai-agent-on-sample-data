import { AppError } from '../utils/errors.js';

const OPERATIONS = new Set(['sum', 'average', 'mean', 'min', 'max', 'count']);
const GRANULARITIES = new Set(['day', 'daily', 'month', 'monthly']);

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parsedDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasColumn(records, column) {
  return records.some((record) => Object.prototype.hasOwnProperty.call(record, column));
}

function normalizeOperation(operation) {
  const normalized = String(operation ?? '').toLowerCase();
  if (!OPERATIONS.has(normalized)) throw new AppError('unsupported time-series operation', 400);
  return normalized === 'mean' ? 'average' : normalized;
}

export function timeSeriesDataset(records, { date_column: dateColumn, value_column: valueColumn, operation, granularity = 'month' } = {}) {
  if (!Array.isArray(records)) throw new AppError('dataset records are required', 400);
  const normalizedOperation = normalizeOperation(operation);
  const normalizedGranularity = String(granularity).toLowerCase();
  if (!GRANULARITIES.has(normalizedGranularity)) throw new AppError('granularity must be daily or monthly', 400);
  if (!hasColumn(records, dateColumn)) throw new AppError(`Column does not exist: ${dateColumn ?? ''}`, 400);
  if (!hasColumn(records, valueColumn)) throw new AppError(`Column does not exist: ${valueColumn ?? ''}`, 400);
  if (!records.some((record) => numericValue(record[valueColumn]) !== null)) {
    throw new AppError(`Column is not numeric-compatible: ${valueColumn}`, 400);
  }

  const buckets = new Map();
  for (const record of records) {
    const date = parsedDate(record[dateColumn]);
    const value = numericValue(record[valueColumn]);
    if (!date || value === null) continue;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const period = normalizedGranularity === 'day' || normalizedGranularity === 'daily'
      ? `${year}-${month}-${day}` : `${year}-${month}`;
    if (!buckets.has(period)) buckets.set(period, []);
    buckets.get(period).push(value);
  }

  const series = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([period, values]) => {
    let value;
    if (normalizedOperation === 'count') value = values.length;
    if (normalizedOperation === 'sum') value = values.reduce((total, number) => total + number, 0);
    if (normalizedOperation === 'average') value = values.reduce((total, number) => total + number, 0) / values.length;
    if (normalizedOperation === 'min') value = Math.min(...values);
    if (normalizedOperation === 'max') value = Math.max(...values);
    return { period, value, count: values.length };
  });

  return { date_column: dateColumn, value_column: valueColumn, operation: normalizedOperation, granularity: normalizedGranularity === 'daily' ? 'day' : normalizedGranularity === 'monthly' ? 'month' : normalizedGranularity, series };
}

export const timeSeriesAnalysisTool = {
  name: 'time_series_analysis',
  description: 'Aggregate a numeric column over a date/time column by day or month.',
  declaration: {
    name: 'time_series_analysis',
    description: 'Analyze a numeric value column over an exact date/time column using daily or monthly buckets.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date_column: { type: 'STRING' },
        value_column: { type: 'STRING' },
        operation: { type: 'STRING', enum: ['sum', 'average', 'mean', 'min', 'max', 'count'] },
        granularity: { type: 'STRING', enum: ['day', 'month', 'daily', 'monthly'] },
      },
      required: ['date_column', 'value_column', 'operation'],
    },
  },
  execute: ({ records, date_column, value_column, operation, granularity }) => timeSeriesDataset(records, { date_column, value_column, operation, granularity }),
};
