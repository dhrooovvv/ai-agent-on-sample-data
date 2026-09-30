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
    .map((column) => {
      const aliases = [column.name, column.name.replace(/_/g, ' ')];
      const positions = aliases.map((alias) => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i').exec(request)?.index ?? -1;
      }).filter((position) => position >= 0);
      return { ...column, position: positions.length ? Math.min(...positions) : -1 };
    })
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

function aggregationColumn(request, columns, operation) {
  const operationWords = {
    sum: 'total|sum',
    average: 'average|avg|mean',
    min: 'minimum|min|lowest',
    max: 'maximum|max|highest',
  }[operation];
  if (operationWords) {
    const matches = mentionedColumns(request, columns)
      .map((column) => {
        const aliases = [column.name, column.name.replace(/_/g, ' ')];
        return aliases.some((alias) => {
          const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`\\b(?:${operationWords})\\b(?:\\s+of)?\\s+(?:the\\s+)?${escaped}(?![A-Za-z0-9_])`, 'i').test(request);
        }) ? column : null;
      })
      .filter(Boolean);
    if (matches.length) return matches[0].name;
  }
  return firstColumn(request, columns, () => true);
}

function parseFilterValue(value) {
  const numeric = numericValue(value);
  const cleaned = value.trim().replace(/[?.!,;]+$/, '').replace(/^['"]|['"]$/g, '');
  const cleanedNumeric = numericValue(cleaned);
  return cleanedNumeric === null ? cleaned : cleanedNumeric;
}

function cleanTextValue(value) {
  return value.trim().replace(/[?.!,;]+$/, '').replace(/^['"]|['"]$/g, '').trim();
}

function conditionForColumn(request, column, records) {
  const aliases = [column.name, column.name.replace(/_/g, ' ')].map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const columnPattern = `(?:${aliases.join('|')})`;
  const explicit = new RegExp(`${columnPattern}\\s*(=|!=|>=|<=|>|<)\\s*([^,;]+?)(?=\\s+(?:and|who|with|that|where)\\b|[?,;]|$)`, 'i').exec(request);
  if (explicit) return { column: column.name, operator: explicit[1], value: parseFilterValue(explicit[2]) };
  const between = new RegExp(`${columnPattern}\\s+between\\s+([^\\s,;]+)\\s+and\\s+([^,;]+?)(?=\\s+(?:and|who|with|that|where)\\b|[?,;]|$)`, 'i').exec(request);
  if (between) return { column: column.name, operator: 'between', value: [parseFilterValue(between[1]), parseFilterValue(between[2])] };

  if (column.type === 'number') {
    const directional = new RegExp(`${columnPattern}\\s+(?:is\\s+)?(?:above|over|greater than|at least|below|under|less than|at most)\\s+(-?(?:\\d+\\.?\\d*|\\.\\d+))`, 'i').exec(request);
    if (directional) {
      const phrase = directional[0].toLowerCase();
      const operator = /at least/.test(phrase) ? '>=' : /at most/.test(phrase) ? '<=' : /below|under|less than/.test(phrase) ? '<' : '>';
      return { column: column.name, operator, value: Number(directional[1]) };
    }
    if (/\bage\b/i.test(column.name)) {
      const agePhrase = /\b(?:above|over|older than|greater than|at least)\s+(-?(?:\d+\.?\d*|\.\d+))(?:\s+years?\s+old)?\b/i.exec(request);
      if (agePhrase) return { column: column.name, operator: /at least/i.test(agePhrase[0]) ? '>=' : '>', value: Number(agePhrase[1]) };
    }
    const yearsName = column.name.replace(/[_ ]years?$/i, '').replace(/_/g, ' ');
    if (yearsName !== column.name) {
      const experiencePhrase = new RegExp(`\\b(?:above|over|greater than|more than|at least)\\s+(-?(?:\\d+\\.?\\d*|\\.\\d+))\\s+years?\\s+(?:of\\s+)?${yearsName}\\b`, 'i').exec(request);
      if (experiencePhrase) return { column: column.name, operator: /at least/i.test(experiencePhrase[0]) ? '>=' : '>', value: Number(experiencePhrase[1]) };
      const directExperiencePhrase = new RegExp(`\\b${yearsName}\\s+(?:is\\s+)?(?:above|over|greater than|more than|at least)\\s+(-?(?:\\d+\\.?\\d*|\\.\\d+))`, 'i').exec(request);
      if (directExperiencePhrase) return { column: column.name, operator: /at least/i.test(directExperiencePhrase[0]) ? '>=' : '>', value: Number(directExperiencePhrase[1]) };
    }
  }

  if (column.type !== 'number') {
    const phrase = new RegExp(`\\bin the\\s+(.+?)\\s+${columnPattern}(?=\\s+(?:who|with|and|that|where)\\b|[?,;]|$)`, 'i').exec(request);
    if (phrase) return { column: column.name, operator: '=', value: cleanTextValue(phrase[1]) };
    const values = [...new Set((records ?? []).map((record) => record[column.name]).filter((value) => typeof value === 'string' && value.trim() !== ''))]
      .sort((left, right) => right.length - left.length);
    const mentionedValue = values.find((value) => new RegExp(`(?<![A-Za-z0-9_])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i').test(request));
    if (mentionedValue) return { column: column.name, operator: '=', value: mentionedValue };
  }
  return null;
}

function filterArguments(request, columns, records) {
  const conditions = columns.map((column) => conditionForColumn(request, column, records)).filter(Boolean);
  if (!conditions.length) throw new AppError('Could not determine the filter condition from the request', 422);
  return { conditions };
}

export function inferToolParameters(tool, request, metadata, records = []) {
  const columns = metadata.columns;
  const numericColumns = columns.filter((column) => column.type === 'number');
  const dateColumns = columns.filter((column) => column.type === 'date');
  if (tool === 'datasetSummary') return {};
  if (tool === 'filterData') return filterArguments(request, columns, records);
  if (tool === 'aggregateData') {
    const operation = operationFromRequest(request, ['sum', 'average', 'min', 'max', 'count'], 'average');
    return { operation, column: operation === 'count' ? undefined : aggregationColumn(request, numericColumns, operation) };
  }
  if (tool === 'correlationAnalysis') {
    const matches = mentionedColumns(request, numericColumns);
    if (matches.length < 2) throw new AppError('Correlation requires two referenced numeric columns', 422);
    return { column_x: matches[0].name, column_y: matches[1].name };
  }
  if (tool === 'groupByAnalysis') {
    const categoricalColumns = columns.filter((column) => column.type !== 'number' && column.type !== 'date');
    const byMatch = mentionedColumns(request, categoricalColumns).find((column) => {
      const aliases = [column.name, column.name.replace(/_/g, ' ')].map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return aliases.some((alias) => new RegExp(`\\bby\\s+(?:the\\s+)?${alias}\\b`, 'i').test(request));
    });
    const groupBy = byMatch?.name ?? firstColumn(request, categoricalColumns, () => true);
    const operation = operationFromRequest(request, ['count', 'sum', 'average', 'min', 'max'], 'average');
    const numericColumns = columns.filter((column) => column.type === 'number');
    return { group_by: groupBy, operation, column: operation === 'count' ? undefined : aggregationColumn(request, numericColumns, operation) };
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
