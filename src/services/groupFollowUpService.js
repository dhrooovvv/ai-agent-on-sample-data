import { AppError } from '../utils/errors.js';

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function selectHighestGroup(groupResult) {
  const groups = groupResult?.groups ?? [];
  const selected = groups
    .filter((group) => numericValue(group.value) !== null)
    .sort((left, right) => numericValue(right.value) - numericValue(left.value))[0];
  if (!selected) throw new AppError('Could not identify the highest-valued group', 422);
  return selected;
}

export function questionRequestsGroupPerformance(question, groupResult) {
  return groupResult?.operation === 'average'
    && /\b(highest|maximum|max)\b/i.test(question)
    && /\b(performance|score)\b/i.test(question);
}

export function questionRequestsGroupedPerformance(question) {
  const ranking = /\b(highest|maximum|max)\b[\s\S]*\b(average|mean)\b|\b(average|mean)\b[\s\S]*\b(highest|maximum|max)\b/i.test(question);
  const grouping = /\b(by|group|department|region|category|team)\b/i.test(question);
  return ranking && grouping
    && /\b(performance|score)\b/i.test(question);
}

export function rowsForGroup(records, groupBy, group) {
  return records.filter((record) => String(record[groupBy] ?? '') === String(group));
}
