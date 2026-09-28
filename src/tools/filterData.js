import { AppError } from '../utils/errors.js';

const OPERATORS = new Set(['=', '!=', '>', '>=', '<', '<=', 'between']);

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function columnExists(records, column) {
  return records.some((record) => Object.prototype.hasOwnProperty.call(record, column));
}

function matchesCondition(record, condition) {
  const { column, operator, value } = condition;
  const actual = record[column];
  if (actual === undefined || actual === null || actual === '') return false;

  const actualNumber = numberValue(actual);
  const targetValues = Array.isArray(value) ? value : [value];
  const targetNumbers = targetValues.map(numberValue);
  const numeric = actualNumber !== null && targetNumbers.every((target) => target !== null);
  if (operator === 'between') {
    if (targetNumbers.length !== 2 || !numeric) throw new AppError(`between requires two numeric values for ${column}`, 400);
    return actualNumber >= targetNumbers[0] && actualNumber <= targetNumbers[1];
  }
  if (numeric) {
    const target = targetNumbers[0];
    if (operator === '=') return actualNumber === target;
    if (operator === '!=') return actualNumber !== target;
    if (operator === '>') return actualNumber > target;
    if (operator === '>=') return actualNumber >= target;
    if (operator === '<') return actualNumber < target;
    if (operator === '<=') return actualNumber <= target;
  }
  if (!['=', '!='].includes(operator)) throw new AppError(`Operator ${operator} requires numeric-compatible values for ${column}`, 400);
  return operator === '=' ? String(actual) === String(value) : String(actual) !== String(value);
}

export function filterDataset(records, { conditions, condition } = {}) {
  if (!Array.isArray(records)) throw new AppError('dataset records are required', 400);
  const requested = conditions ?? (condition ? [condition] : []);
  if (!Array.isArray(requested) || requested.length === 0) throw new AppError('at least one filter condition is required', 400);
  for (const item of requested) {
    if (!item || typeof item.column !== 'string' || !columnExists(records, item.column)) {
      throw new AppError(`Column does not exist: ${item?.column ?? ''}`, 400);
    }
    if (!OPERATORS.has(item.operator)) throw new AppError(`Unsupported filter operator: ${item.operator}`, 400);
    if (item.operator === 'between' && (!Array.isArray(item.value) || item.value.length !== 2)) {
      throw new AppError('between requires a two-value array', 400);
    }
  }
  const rows = records.filter((record) => requested.every((item) => matchesCondition(record, item)));
  const result = { matched_rows: rows.length, total_rows: records.length, rows };
  if (requested.length === 1) {
    Object.assign(result, { column: requested[0].column, operator: requested[0].operator, value: requested[0].value });
  } else {
    result.conditions = requested;
  }
  return result;
}

export const filterDataTool = {
  name: 'filter_data',
  description: 'Filter dataset rows using one or more AND conditions.',
  declaration: {
    name: 'filter_data',
    description: 'Filter rows with exact dataset column names. Conditions are combined with AND and calculations are performed by the application.',
    parameters: {
      type: 'OBJECT',
      properties: {
        conditions: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: {
            column: { type: 'STRING' },
            operator: { type: 'STRING', enum: ['=', '!=', '>', '>=', '<', '<=', 'between'] },
            value: { description: 'Comparison value, or two numeric values for between.' },
          }, required: ['column', 'operator', 'value'] },
        },
      },
      required: ['conditions'],
    },
  },
  execute: ({ records, conditions }) => filterDataset(records, { conditions }),
};
