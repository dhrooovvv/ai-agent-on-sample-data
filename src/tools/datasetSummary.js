const MISSING = new Set(['', null, undefined]);

function isMissing(value) {
  return MISSING.has(value) || (typeof value === 'string' && value.trim() === '');
}

function isNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseTypedValue(raw) {
  if (isMissing(raw)) return null;
  const value = String(raw).trim();
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number(value);
  // Require an ISO-like or unambiguous date shape to avoid classifying ordinary text as dates.
  if (/^\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return value;
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function numericStats(values) {
  const numbers = values.filter(isNumeric).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const sum = numbers.reduce((total, value) => total + value, 0);
  const mean = sum / numbers.length;
  const variance = numbers.reduce((total, value) => total + ((value - mean) ** 2), 0) / numbers.length;
  return {
    count: numbers.length,
    sum,
    min: numbers[0],
    max: numbers[numbers.length - 1],
    mean,
    median: median(numbers),
    standardDeviation: Math.sqrt(variance),
  };
}

export function summarizeDataset(records) {
  const columnNames = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const columns = {};

  for (const columnName of columnNames) {
    const values = records.map((record) => parseTypedValue(record[columnName]));
    const observed = values.filter((value) => value !== null);
    const type = observed.length === 0 ? 'unknown'
      : observed.every(isNumeric) ? 'number'
        : observed.every((value) => value instanceof Date) ? 'date'
          : observed.every((value) => typeof value === 'boolean') ? 'boolean' : 'string';
    const uniqueValues = new Set(observed.map((value) => value instanceof Date ? value.toISOString() : value));
    columns[columnName] = {
      dataType: type,
      missingCount: values.length - observed.length,
      uniqueValueCount: uniqueValues.size,
      numericStatistics: numericStats(values),
    };
  }

  return {
    rowCount: records.length,
    columnCount: columnNames.length,
    columnNames,
    columns,
  };
}

export const datasetSummaryTool = {
  name: 'dataset_summary',
  description: 'Summarize the uploaded dataset with dimensions, types, missing values, unique values, and numeric statistics.',
  declaration: {
    name: 'dataset_summary',
    description: 'Return a complete structural and numeric summary of the uploaded CSV dataset.',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  execute: ({ records }) => summarizeDataset(records),
};
