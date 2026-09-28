import { AppError } from '../utils/errors.js';

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasColumn(records, column) {
  return records.some((record) => Object.prototype.hasOwnProperty.call(record, column));
}

export function correlateDataset(records, { column_x: columnX, column_y: columnY } = {}) {
  if (!Array.isArray(records)) throw new AppError('dataset records are required', 400);
  if (!hasColumn(records, columnX)) throw new AppError(`Column does not exist: ${columnX ?? ''}`, 400);
  if (!hasColumn(records, columnY)) throw new AppError(`Column does not exist: ${columnY ?? ''}`, 400);
  const pairs = records.map((record) => [numericValue(record[columnX]), numericValue(record[columnY])])
    .filter(([x, y]) => x !== null && y !== null);
  if (pairs.length < 2) throw new AppError('at least two valid numeric pairs are required', 400);
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  const numerator = pairs.reduce((sum, [x, y]) => sum + ((x - meanX) * (y - meanY)), 0);
  const denominatorX = Math.sqrt(pairs.reduce((sum, [x]) => sum + ((x - meanX) ** 2), 0));
  const denominatorY = Math.sqrt(pairs.reduce((sum, [, y]) => sum + ((y - meanY) ** 2), 0));
  const correlation = denominatorX === 0 || denominatorY === 0 ? null : numerator / (denominatorX * denominatorY);
  return { column_x: columnX, column_y: columnY, correlation, valid_pairs: pairs.length };
}

export const correlationAnalysisTool = {
  name: 'correlation_analysis',
  description: 'Calculate Pearson correlation between two numeric columns.',
  declaration: {
    name: 'correlation_analysis',
    description: 'Calculate Pearson correlation between two exact numeric dataset columns. Missing or invalid pairs are ignored.',
    parameters: {
      type: 'OBJECT',
      properties: { column_x: { type: 'STRING' }, column_y: { type: 'STRING' } },
      required: ['column_x', 'column_y'],
    },
  },
  execute: ({ records, column_x, column_y }) => correlateDataset(records, { column_x, column_y }),
};
