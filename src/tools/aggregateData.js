import { AppError } from '../utils/errors.js';

const OPERATIONS = new Set(['sum', 'average', 'mean', 'min', 'max', 'count']);

function normalizeOperation(operation) {
  const normalized = String(operation ?? '').trim().toLowerCase();
  if (!OPERATIONS.has(normalized)) {
    throw new AppError('operation must be one of: sum, average, mean, min, max, count', 400);
  }
  return normalized === 'mean' ? 'average' : normalized;
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim();
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function columnExists(records, column) {
  return records.some((record) => Object.prototype.hasOwnProperty.call(record, column));
}

export function aggregateDataset(records, { operation, column } = {}) {
  const normalizedOperation = normalizeOperation(operation);
  if (!Array.isArray(records)) throw new AppError('dataset records are required', 400);

  if (normalizedOperation === 'count') {
    if (column !== undefined && !columnExists(records, column)) {
      throw new AppError(`Column does not exist: ${column}`, 400);
    }
    return { operation: 'count', column: column ?? null, value: records.length, valid_values: records.length };
  }

  if (typeof column !== 'string' || column.trim() === '') {
    throw new AppError('column is required for numeric aggregation', 400);
  }
  if (!columnExists(records, column)) throw new AppError(`Column does not exist: ${column}`, 400);

  const values = records.map((record) => numericValue(record[column])).filter((value) => value !== null);
  if (!values.length) throw new AppError(`Column is not numeric-compatible: ${column}`, 400);

  let value;
  if (normalizedOperation === 'sum') value = values.reduce((total, number) => total + number, 0);
  if (normalizedOperation === 'average') value = values.reduce((total, number) => total + number, 0) / values.length;
  if (normalizedOperation === 'min') value = Math.min(...values);
  if (normalizedOperation === 'max') value = Math.max(...values);

  return { operation: normalizedOperation, column, value, valid_values: values.length };
}

export const aggregateDataTool = {
  name: 'aggregate_data',
  description: 'Calculate one numeric aggregation for a requested dataset column, or count records.',
  declaration: {
    name: 'aggregate_data',
    description: 'Calculate sum, average, minimum, maximum, or record count using the requested column and operation. The application performs the calculation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        operation: { type: 'STRING', enum: ['sum', 'average', 'mean', 'min', 'max', 'count'] },
        column: { type: 'STRING', description: 'Exact dataset column name. Omit only for counting all records.' },
      },
      required: ['operation'],
    },
  },
  execute: ({ records, operation, column }) => aggregateDataset(records, { operation, column }),
};
