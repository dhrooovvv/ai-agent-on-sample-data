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
    expect(Object.keys(response.body).sort()).toEqual(['answer', 'tools_used']);
    expect(response.body.answer).toBe('The dataset contains 15 rows and 9 columns.');
    expect(response.body.tools_used).toEqual(['dataset_summary']);
  });

  it('rejects requests without a CSV file', async () => {
    const response = await request(createApp({ agentService: fakeAgentService() }))
      .post('/analyze')
      .field('question', 'Give me an overview of this dataset.');
    expect(response.status).toBe(400);
  });

  it('selects aggregate_data for a natural-language numeric question', async () => {
    const jevService = {
      async chooseTool({ userRequest, dataset, availableTools }) {
        expect(userRequest).toBe('What is the average revenue?');
        expect(dataset.rows).toBe(15);
        expect(dataset.columns).toContainEqual({ name: 'revenue', type: 'number' });
        expect(availableTools.map(({ name }) => name)).toEqual([
          'datasetSummary', 'filterData', 'aggregateData', 'groupByAnalysis', 'correlationAnalysis',
          'regressionAnalysis', 'timeSeriesAnalysis', 'review',
        ]);
        return { tool: 'aggregateData' };
      },
    };
    const csv = await readFile(samplePath);
    const response = await request(createApp({ agentService: createAgentService({ jevService }) }))
      .post('/analyze')
      .field('question', 'What is the average revenue?')
      .attach('file', csv, 'sample_sales.csv');

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['answer', 'tools_used']);
    expect(response.body.answer).toBe('The average of revenue is 200.7.');
    expect(response.body.tools_used).toEqual(['aggregate_data']);
  });

  async function requestWithTool(question, selectedTool) {
    const jevService = { async chooseTool() { return { tool: selectedTool }; } };
    const csv = await readFile(samplePath);
    return request(createApp({ agentService: createAgentService({ jevService }) }))
      .post('/analyze')
      .field('question', question)
      .attach('file', csv, 'sample_sales.csv');
  }

  it('selects filter_data for a natural-language filter question', async () => {
    const response = await requestWithTool('Which sales had revenue over 500?', 'filterData');
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['answer', 'tools_used']);
    expect(response.body.tools_used).toEqual(['filter_data']);
  });

  it('selects correlation_analysis for a natural-language correlation question', async () => {
    const response = await requestWithTool('What is the correlation between units and revenue?', 'correlationAnalysis');
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['answer', 'tools_used']);
    expect(response.body.tools_used).toEqual(['correlation_analysis']);
  });

  it('selects time_series_analysis for a natural-language trend question', async () => {
    const response = await requestWithTool('Show total revenue by month.', 'timeSeriesAnalysis');
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['answer', 'tools_used']);
    expect(response.body.tools_used).toEqual(['time_series_analysis']);
  });
});
