import { describe, expect, it } from 'vitest';
import { filterDataset } from '../../src/tools/filterData.js';
import { groupDataset } from '../../src/tools/groupByAnalysis.js';
import { correlateDataset } from '../../src/tools/correlationAnalysis.js';
import { timeSeriesDataset } from '../../src/tools/timeSeriesAnalysis.js';

const employees = [
  { name: 'A', department: 'Engineering', salary: '70000', score: '1' },
  { name: 'B', department: 'Engineering', salary: '80000', score: '2' },
  { name: 'C', department: 'Sales', salary: '50000', score: '3' },
  { name: 'D', department: 'Sales', salary: '', score: 'bad' },
];

describe('filter_data', () => {
  it('filters numeric and string conditions, including AND conditions', () => {
    expect(filterDataset(employees, { conditions: [{ column: 'salary', operator: '>=', value: 70000 }] }).matched_rows).toBe(2);
    const result = filterDataset(employees, { conditions: [
      { column: 'department', operator: '=', value: 'Engineering' },
      { column: 'salary', operator: '>', value: 70000 },
    ] });
    expect(result.rows.map((row) => row.name)).toEqual(['B']);
  });

  it('supports between and rejects unknown columns', () => {
    expect(filterDataset(employees, { condition: { column: 'salary', operator: 'between', value: [60000, 80000] } }).matched_rows).toBe(2);
    expect(() => filterDataset(employees, { condition: { column: 'unknown', operator: '=', value: 'x' } }))
      .toThrow('Column does not exist: unknown');
  });
});

describe('group_by_analysis', () => {
  it('groups counts and averages deterministically', () => {
    expect(groupDataset(employees, { group_by: 'department', operation: 'count' })).toEqual({
      group_by: 'department', operation: 'count', column: null,
      groups: [
        { group: 'Engineering', value: 2, count: 2 },
        { group: 'Sales', value: 2, count: 2 },
      ],
    });
    const result = groupDataset(employees, { group_by: 'department', operation: 'average', column: 'salary' });
    expect(result.groups).toEqual([
      { group: 'Engineering', value: 75000, count: 2 },
      { group: 'Sales', value: 50000, count: 1 },
    ]);
  });

  it('rejects invalid group or aggregation columns', () => {
    expect(() => groupDataset(employees, { group_by: 'missing', operation: 'count' })).toThrow('Column does not exist');
    expect(() => groupDataset(employees, { group_by: 'department', operation: 'sum', column: 'name' }))
      .toThrow(/numeric|NaN/);
  });
});

describe('correlation_analysis', () => {
  it('calculates Pearson correlation and ignores invalid pairs', () => {
    const result = correlateDataset([
      { x: '1', y: '2' }, { x: '2', y: '4' }, { x: 'bad', y: '6' }, { x: '3', y: '6' },
    ], { column_x: 'x', column_y: 'y' });
    expect(result.correlation).toBeCloseTo(1);
    expect(result.valid_pairs).toBe(3);
  });

  it('handles zero variance and invalid columns safely', () => {
    expect(correlateDataset([{ x: '1', y: '2' }, { x: '1', y: '3' }], { column_x: 'x', column_y: 'y' }).correlation).toBeNull();
    expect(() => correlateDataset(employees, { column_x: 'missing', column_y: 'salary' })).toThrow('Column does not exist');
    expect(() => correlateDataset([{ x: 'a', y: 'b' }], { column_x: 'x', column_y: 'y' })).toThrow('numeric pairs');
  });
});

describe('time_series_analysis', () => {
  const observations = [
    { observed_at: '2026-01-02', amount: '10' },
    { observed_at: '2026-01-15', amount: '20' },
    { observed_at: '2026-02-01', amount: '30' },
    { observed_at: 'invalid', amount: '40' },
    { observed_at: '2026-02-02', amount: '' },
  ];

  it('aggregates daily and monthly values chronologically', () => {
    const daily = timeSeriesDataset(observations, { date_column: 'observed_at', value_column: 'amount', operation: 'sum', granularity: 'day' });
    expect(daily.series).toEqual([
      { period: '2026-01-02', value: 10, count: 1 },
      { period: '2026-01-15', value: 20, count: 1 },
      { period: '2026-02-01', value: 30, count: 1 },
    ]);
    const monthly = timeSeriesDataset(observations, { date_column: 'observed_at', value_column: 'amount', operation: 'average', granularity: 'month' });
    expect(monthly.series).toEqual([
      { period: '2026-01', value: 15, count: 2 },
      { period: '2026-02', value: 30, count: 1 },
    ]);
  });

  it('rejects invalid columns and non-numeric values', () => {
    expect(() => timeSeriesDataset(observations, { date_column: 'missing', value_column: 'amount', operation: 'sum' }))
      .toThrow('Column does not exist');
    expect(() => timeSeriesDataset([{ observed_at: '2026-01-01', amount: 'x' }], { date_column: 'observed_at', value_column: 'amount', operation: 'sum' }))
      .toThrow('numeric-compatible');
  });
});
