import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseCsvBuffer } from '../../src/services/csvService.js';
import { summarizeDataset } from '../../src/tools/datasetSummary.js';

describe('dataset_summary', () => {
  it('summarizes the sample dataset dynamically', async () => {
    const records = parseCsvBuffer(await readFile(new URL('../../sample_data/sample_sales.csv', import.meta.url)));
    const summary = summarizeDataset(records);
    expect(summary.rowCount).toBe(15);
    expect(summary.columnCount).toBe(9);
    expect(summary.columnNames).toEqual(['date', 'region', 'product', 'category', 'units', 'unit_price', 'revenue', 'customer_type', 'returned']);
    expect(summary.columns.units.dataType).toBe('number');
    expect(summary.columns.units.numericStatistics.mean).toBeCloseTo(9.6667, 3);
    expect(summary.columns.region.uniqueValueCount).toBe(4);
    expect(summary.columns.revenue.missingCount).toBe(0);
  });

  it('counts missing values and unique values without a fixed schema', () => {
    const summary = summarizeDataset([
      { alpha: '1', beta: 'x' },
      { alpha: '', beta: 'x' },
      { alpha: '3', beta: 'y' },
    ]);
    expect(summary.columnNames).toEqual(['alpha', 'beta']);
    expect(summary.columns.alpha.missingCount).toBe(1);
    expect(summary.columns.alpha.uniqueValueCount).toBe(2);
    expect(summary.columns.alpha.numericStatistics.sum).toBe(4);
  });
});
