import { AppError } from '../utils/errors.js';

export function resultKind(result) {
  if (Array.isArray(result)) return 'dataset';
  if (!result || typeof result !== 'object') return 'unknown';
  if (Array.isArray(result.groups)) return 'grouped_result';
  if (Array.isArray(result.rows)) return 'dataset_result';
  if (result.row && typeof result.row === 'object') return 'row_result';
  if (typeof result.value === 'number' && typeof result.operation === 'string') return 'scalar_result';
  if (Array.isArray(result.series)) return 'series_result';
  return 'analysis_result';
}

function selectionDirection(selection) {
  return ['min', 'lowest', 'bottom'].includes(selection) ? 'min' : 'max';
}

export function selectGroup(groupedResult, { selection = 'max' } = {}) {
  if (resultKind(groupedResult) !== 'grouped_result' || groupedResult.groups.length === 0) {
    throw new AppError('select_group requires a non-empty grouped result', 422);
  }
  const direction = selectionDirection(selection);
  const groups = [...groupedResult.groups].sort((left, right) => {
    const difference = Number(left.value) - Number(right.value);
    if (difference !== 0) return direction === 'max' ? -difference : difference;
    return String(left.group).localeCompare(String(right.group));
  });
  const selected = groups[0];
  return {
    operation: direction === 'max' ? 'max_group' : 'min_group',
    group_by: groupedResult.group_by,
    group: selected.group,
    value: selected.value,
    count: selected.count,
  };
}

export function lookupRow(records, aggregateResult, { column, selection = 'max' } = {}) {
  if (!Array.isArray(records)) throw new AppError('lookup_row requires dataset records', 422);
  if (resultKind(aggregateResult) !== 'scalar_result') {
    throw new AppError('lookup_row requires a scalar aggregate result', 422);
  }
  const aggregateColumn = column ?? aggregateResult.column;
  if (typeof aggregateColumn !== 'string' || !aggregateColumn) {
    throw new AppError('lookup_row requires an aggregate column', 422);
  }
  const target = Number(aggregateResult.value);
  const row = records.find((candidate) => Number(candidate[aggregateColumn]) === target);
  if (!row) throw new AppError(`No row matches ${aggregateColumn} = ${aggregateResult.value}`, 422);
  const direction = selectionDirection(selection);
  const typed = Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === 'number') return [key, value];
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return [key, Number(value)];
    return [key, value];
  }));
  return {
    operation: direction === 'max' ? 'max_row' : 'min_row',
    column: aggregateColumn,
    value: aggregateResult.value,
    row: typed,
  };
}
