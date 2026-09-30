import { AppError } from '../utils/errors.js';

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function typedRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const number = numericValue(value);
    return [key, number === null ? value : number];
  }));
}

export function lookupMaximumRow(records, aggregateResult) {
  if (!Array.isArray(records) || !aggregateResult || aggregateResult.operation !== 'max') {
    throw new AppError('A maximum aggregation result is required for row lookup', 422);
  }
  const target = numericValue(aggregateResult.value);
  const row = records.find((record) => numericValue(record[aggregateResult.column]) === target);
  if (!row) throw new AppError('Could not find the row matching the maximum value', 422);
  return {
    operation: 'max_row',
    column: aggregateResult.column,
    value: target,
    row: typedRow(row),
  };
}

export function questionRequestsRow(question, result) {
  const text = String(question).toLowerCase();
  const identityRequest = /\b(who|which|person|name|their|row|record)\b/.test(text)
    || (/\b(employee|employees)\b/.test(text) && /\b(maximum|max|highest|minimum|min|lowest)\b/.test(text));
  return ['max', 'min'].includes(result?.operation) && identityRequest;
}
