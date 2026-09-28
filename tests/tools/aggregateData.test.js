import { describe, expect, it } from 'vitest';
import { aggregateDataset } from '../../src/tools/aggregateData.js';

const records = [
  { amount: '10', label: 'a' },
  { amount: '20', label: 'b' },
  { amount: '30', label: 'a' },
];

describe('aggregate_data', () => {
  it('calculates an average', () => {
    expect(aggregateDataset(records, { operation: 'average', column: 'amount' })).toEqual({
      operation: 'average', column: 'amount', value: 20, valid_values: 3,
    });
  });

  it('calculates sum, minimum, and maximum', () => {
    expect(aggregateDataset(records, { operation: 'sum', column: 'amount' }).value).toBe(60);
    expect(aggregateDataset(records, { operation: 'min', column: 'amount' }).value).toBe(10);
    expect(aggregateDataset(records, { operation: 'max', column: 'amount' }).value).toBe(30);
  });

  it('counts records without requiring a numeric column', () => {
    expect(aggregateDataset(records, { operation: 'count' })).toEqual({
      operation: 'count', column: null, value: 3, valid_values: 3,
    });
  });

  it('ignores missing and invalid numeric values while reporting valid_values', () => {
    const result = aggregateDataset([
      { amount: '10' },
      { amount: '' },
      { amount: 'not-a-number' },
      { amount: '30' },
    ], { operation: 'average', column: 'amount' });
    expect(result.value).toBe(20);
    expect(result.valid_values).toBe(2);
  });

  it('rejects nonexistent and non-numeric columns', () => {
    expect(() => aggregateDataset(records, { operation: 'sum', column: 'missing' }))
      .toThrow('Column does not exist: missing');
    expect(() => aggregateDataset(records, { operation: 'sum', column: 'label' }))
      .toThrow('Column is not numeric-compatible: label');
  });
});
