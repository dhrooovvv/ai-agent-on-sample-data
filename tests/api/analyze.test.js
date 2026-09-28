import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import { createApp } from '../../src/server.js';
import { createAgentService } from '../../src/agent/agentService.js';

const samplePath = new URL('../../sample_data/sample_sales.csv', import.meta.url);

function fakeAgentService() {
  return {
    async analyze({ question }) {
      return {
        answer: 'The dataset contains 15 rows and 9 columns.',
        result: {
          rows: 15,
          columns: 9,
          column_names: ['date', 'region', 'product', 'category', 'units', 'unit_price', 'revenue', 'customer_type', 'returned'],
        },
        toolsUsed: ['dataset_summary'],
        question,
      };
    },
  };
}

describe('POST /analyze', () => {
  it('accepts a CSV upload and returns the analysis contract', async () => {
    const csv = await readFile(samplePath);
    const response = await request(createApp({ agentService: fakeAgentService() }))
      .post('/analyze')
      .field('question', 'How many rows and columns are in this dataset?')
      .attach('file', csv, 'sample_sales.csv');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.question).toBe('How many rows and columns are in this dataset?');
    expect(response.body.answer).toBe('The dataset contains 15 rows and 9 columns.');
    expect(response.body.result).toEqual({
      rows: 15,
      columns: 9,
      column_names: ['date', 'region', 'product', 'category', 'units', 'unit_price', 'revenue', 'customer_type', 'returned'],
    });
    expect(response.body.result.rows).toBe(15);
    expect(response.body.result.columns).toBe(9);
    expect(response.body.result.column_names).toHaveLength(9);
    expect(response.body.tools_used).toEqual(['dataset_summary']);
  });

  it('rejects requests without a CSV file', async () => {
    const response = await request(createApp({ agentService: fakeAgentService() }))
      .post('/analyze')
      .field('question', 'Give me an overview of this dataset.');
    expect(response.status).toBe(400);
  });

  it('selects aggregate_data for a natural-language numeric question', async () => {
    let callNumber = 0;
    const client = {
      models: {
        async generateContent() {
          callNumber += 1;
          if (callNumber === 1) {
            return { candidates: [{ content: { parts: [{ functionCall: {
              name: 'aggregate_data', args: { operation: 'average', column: 'revenue' },
            } }] } }] };
          }
          return { candidates: [{ content: { parts: [{ text: 'The average has been calculated.' }] } }] };
        },
      },
    };
    const csv = await readFile(samplePath);
    const response = await request(createApp({ agentService: createAgentService({ client }) }))
      .post('/analyze')
      .field('question', 'What is the average revenue?')
      .attach('file', csv, 'sample_sales.csv');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.answer).toBe('The average of revenue is 200.7.');
    expect(response.body.result).toEqual({
      operation: 'average', column: 'revenue', value: 200.7, valid_values: 15,
    });
    expect(response.body.tools_used).toEqual(['aggregate_data']);
  });

  async function requestWithTool(question, functionCall) {
    let callNumber = 0;
    const client = {
      models: {
        async generateContent() {
          callNumber += 1;
          return callNumber === 1
            ? { candidates: [{ content: { parts: [{ functionCall }] } }] }
            : { candidates: [{ content: { parts: [{ text: 'The requested analysis is complete.' }] } }] };
        },
      },
    };
    const csv = await readFile(samplePath);
    return request(createApp({ agentService: createAgentService({ client }) }))
      .post('/analyze')
      .field('question', question)
      .attach('file', csv, 'sample_sales.csv');
  }

  it('selects filter_data for a natural-language filter question', async () => {
    const response = await requestWithTool('Which sales had revenue over 500?', {
      name: 'filter_data', args: { conditions: [{ column: 'revenue', operator: '>', value: 500 }] },
    });
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['filter_data']);
    expect(response.body.result.matched_rows).toBe(1);
  });

  it('selects group_by_analysis for a natural-language grouped question', async () => {
    const response = await requestWithTool('What is average revenue by region?', {
      name: 'group_by_analysis', args: { group_by: 'region', operation: 'average', column: 'revenue' },
    });
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['group_by_analysis']);
    expect(response.body.result.groups).toHaveLength(4);
  });

  it('selects correlation_analysis for a natural-language correlation question', async () => {
    const response = await requestWithTool('What is the correlation between units and revenue?', {
      name: 'correlation_analysis', args: { column_x: 'units', column_y: 'revenue' },
    });
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['correlation_analysis']);
    expect(response.body.result.valid_pairs).toBe(15);
  });

  it('selects time_series_analysis for a natural-language trend question', async () => {
    const response = await requestWithTool('Show total revenue by month.', {
      name: 'time_series_analysis', args: {
        date_column: 'date', value_column: 'revenue', operation: 'sum', granularity: 'month',
      },
    });
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['time_series_analysis']);
    expect(response.body.result.series).toHaveLength(1);
    expect(response.body.result.series[0].period).toBe('2026-01');
  });
});
