import { AppError } from '../utils/errors.js';

const OPERATIONS = new Set(['count', 'sum', 'average', 'mean', 'min', 'max']);

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeOperation(operation) {
  const normalized = String(operation ?? '').toLowerCase();
  if (!OPERATIONS.has(normalized)) throw new AppError('unsupported group aggregation operation', 400);
  return normalized === 'mean' ? 'average' : normalized;
}

function hasColumn(records, column) {
  return records.some((record) => Object.prototype.hasOwnProperty.call(record, column));
}

export function groupDataset(records, { group_by: groupBy, operation, column } = {}) {
  if (!Array.isArray(records)) throw new AppError('dataset records are required', 400);
  const normalizedOperation = normalizeOperation(operation);
  if (typeof groupBy !== 'string' || !hasColumn(records, groupBy)) throw new AppError(`Column does not exist: ${groupBy ?? ''}`, 400);
  if (normalizedOperation !== 'count' && (typeof column !== 'string' || !hasColumn(records, column))) {
    throw new AppError(`Column does not exist: ${column ?? ''}`, 400);
  }
  if (normalizedOperation === 'count' && column !== undefined && !hasColumn(records, column)) {
    throw new AppError(`Column does not exist: ${column}`, 400);
  }
  if (normalizedOperation !== 'count' && !records.some((record) => numericValue(record[column]) !== null)) {
    throw new AppError(`Column is not numeric-compatible: ${column}`, 400);
  }

  const groups = new Map();
  for (const record of records) {
    const group = record[groupBy] === undefined || record[groupBy] === '' ? null : record[groupBy];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(record);
  }

  const output = [...groups.entries()].map(([group, groupRows]) => {
    if (normalizedOperation === 'count') return { group, value: groupRows.length, count: groupRows.length };
    const values = groupRows.map((record) => numericValue(record[column])).filter((value) => value !== null);
    let value = null;
    if (values.length) {
      if (normalizedOperation === 'sum') value = values.reduce((total, number) => total + number, 0);
      if (normalizedOperation === 'average') value = values.reduce((total, number) => total + number, 0) / values.length;
      if (normalizedOperation === 'min') value = Math.min(...values);
      if (normalizedOperation === 'max') value = Math.max(...values);
    }
    return { group, value, count: values.length };
  }).sort((left, right) => String(left.group ?? '').localeCompare(String(right.group ?? '')));

  return { group_by: groupBy, operation: normalizedOperation, column: column ?? null, groups: output };
}

export const groupByAnalysisTool = {
  name: 'group_by_analysis',
  description: 'Group rows by a categorical column and calculate a deterministic aggregation per group.',
  declaration: {
    name: 'group_by_analysis',
    description: 'Group by an exact dataset column and calculate count, sum, average, minimum, or maximum for another column.',
    parameters: {
      type: 'OBJECT',
      properties: {
        group_by: { type: 'STRING' },
        operation: { type: 'STRING', enum: ['count', 'sum', 'average', 'mean', 'min', 'max'] },
        column: { type: 'STRING', description: 'Numeric aggregation column; omit for count.' },
      },
      required: ['group_by', 'operation'],
    },
  },
  execute: ({ records, group_by, operation, column }) => groupDataset(records, { group_by, operation, column }),
};
