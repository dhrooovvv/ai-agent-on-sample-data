import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import { createApp } from '../../src/server.js';
import { createAgentService } from '../../src/agent/agentService.js';

const employeesPath = new URL('../../sample_data/test_employees.csv', import.meta.url);
const largeEmployeesPath = new URL('../../sample_data/large_employees.csv', import.meta.url);

function agentFor(plan) {
  return createAgentService({ jevService: { async choosePlan() { return plan; } } });
}

async function analyze(question, plan) {
  const response = await request(createApp({ agentService: agentFor(plan) }))
    .post('/analyze')
    .field('question', question)
    .attach('file', await readFile(employeesPath), 'test_employees.csv');
  return response;
}

async function analyzeFile(filePath, question, plan) {
  return request(createApp({ agentService: agentFor(plan) }))
    .post('/analyze')
    .field('question', question)
    .attach('file', await readFile(filePath), 'employees.csv');
}

describe('multi-step JEV plans', () => {
  it('executes a simple average salary query as one tool', async () => {
    const response = await analyze('What is the average salary?', {
      plan: [{ tool: 'aggregateData', parameters: { operation: 'average', column: 'salary' } }],
    });
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['aggregate_data']);
    expect(response.body.result).toMatchObject({ operation: 'average', column: 'salary', valid_values: 10 });
  });

  it('feeds Engineering employees over 30 into average salary', async () => {
    const response = await analyze('What is the average salary of employees in the Engineering department who are over 30 years old?', {
      plan: [
        { tool: 'filterData' },
        { tool: 'aggregateData' },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['filter_data', 'aggregate_data']);
    expect(response.body.result).toMatchObject({ operation: 'average', column: 'salary', value: 85000, valid_values: 1 });
  });

  it('rejects an under-planned aggregate decision when the request contains filters', async () => {
    const response = await analyze('What is the average salary of Engineering employees over 30 years old?', {
      plan: [{ tool: 'aggregateData' }],
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/filterData is required/);
  });

  it('feeds Engineering employees with more than five years experience into average performance', async () => {
    const response = await analyze('What is the average performance_score of Engineering employees with more than 5 years experience?', {
      plan: [
        { tool: 'filterData' },
        { tool: 'aggregateData' },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['filter_data', 'aggregate_data']);
    expect(response.body.result).toMatchObject({ operation: 'average', column: 'performance_score', value: 91, valid_values: 2 });
  });

  it('rejects an unsupported review plan without executing a tool', async () => {
    const response = await analyze('Send this dataset to my friend.', { plan: [{ tool: 'review' }] });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/selected review/);
  });

  it('looks up the complete maximum-salary row after filtering', async () => {
    const response = await analyzeFile(
      largeEmployeesPath,
      'Among Engineering employees over 30 with more than 5 years of experience, who has the highest salary and what is their performance score?',
      { plan: [
        { tool: 'filterData' },
        { tool: 'aggregateData' },
        { operation: 'lookup_row', parameters: { column: 'salary', selection: 'max' } },
      ] },
    );
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['filter_data', 'aggregate_data']);
    expect(response.body.answer).toBe('Nisha Kapoor 170 has the highest salary value of 111290 and a performance score of 80.');
    expect(response.body.result).toEqual({
      operation: 'max_row',
      column: 'salary',
      value: 111290,
      row: {
        employee: 'Nisha Kapoor 170',
        department: 'Engineering',
        age: 31,
        salary: 111290,
        experience_years: 10,
        performance_score: 80,
      },
    });
  });

  it('parses multiple natural-language filters before grouped analysis', async () => {
    const response = await analyzeFile(
      largeEmployeesPath,
      'for employees over 30 with more than 5 years of experience, find the department with the highest average salary and report its average performance score.',
      { plan: [
        { tool: 'filterData' },
        { tool: 'groupByAnalysis' },
        { operation: 'select_group', parameters: { selection: 'max' } },
        { tool: 'aggregateData', parameters: { operation: 'average', column: 'performance_score' } },
      ] },
    );
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['filter_data', 'group_by_analysis', 'aggregate_data']);
    expect(response.body.result).toMatchObject({
      operation: 'group_max_follow_up',
      group_by: 'department',
      group: 'Product',
      follow_up: { operation: 'average', column: 'performance_score', value: 81.1, valid_values: 20 },
    });
  });

  it('executes explicit grouped selection and follow-up aggregation without losing rows', async () => {
    const response = await analyzeFile(
      largeEmployeesPath,
      'find the department with the highest average salary and report its average performance score',
      {
        plan: [
          { tool: 'filterData', parameters: { conditions: [{ column: 'age', operator: '>', value: 30 }] } },
          { tool: 'groupByAnalysis', parameters: { group_by: 'department', operation: 'average', column: 'salary' } },
          { operation: 'select_group', parameters: { selection: 'max' } },
          { tool: 'aggregateData', parameters: { operation: 'average', column: 'performance_score' } },
        ],
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['filter_data', 'group_by_analysis', 'aggregate_data']);
    expect(response.body.execution_trace.map((step) => step.name)).toEqual([
      'filter_data', 'group_by_analysis', 'select_group', 'aggregate_data',
    ]);
    expect(response.body.result).toMatchObject({
      operation: 'group_max_follow_up',
      group_by: 'department',
      follow_up: { operation: 'average', column: 'performance_score' },
    });
  });

  it('executes explicit row lookup after a maximum aggregate', async () => {
    const response = await analyzeFile(
      largeEmployeesPath,
      'which employee has the maximum salary?',
      {
        plan: [
          { tool: 'aggregateData', parameters: { operation: 'max', column: 'salary' } },
          { operation: 'lookup_row', parameters: { column: 'salary', selection: 'max' } },
        ],
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.tools_used).toEqual(['aggregate_data']);
    expect(response.body.execution_trace.map((step) => step.name)).toEqual(['aggregate_data', 'lookup_row']);
    expect(response.body.result).toMatchObject({ operation: 'max_row', column: 'salary', value: 121956 });
  });

  it('rejects a plan that ends at an intermediate filtered result', async () => {
    const response = await analyze('What is the average salary?', {
      plan: [{ tool: 'filterData', parameters: { conditions: [{ column: 'age', operator: '>', value: 30 }] } }],
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/aggregation was completed/);
  });

  it('rejects a grouped intermediate result when the question asks for the top group metric', async () => {
    const response = await analyzeFile(
      largeEmployeesPath,
      'find the department with the highest average salary and report its average performance score',
      { plan: [{ tool: 'groupByAnalysis' }] },
    );
    expect(response.status).toBe(422);
    expect(response.body.error).toMatch(/filterData is required|select_group is required/);
  });
});
