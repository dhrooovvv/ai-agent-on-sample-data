import { describe, expect, it } from 'vitest';
import { createJevService } from '../../src/services/jevService.js';

const availableTools = [
  { name: 'datasetSummary', description: 'Summarize the dataset.' },
  { name: 'review', description: 'Review unsupported requests.' },
];

describe('JEV service', () => {
  it('sends metadata and consumes the typed choice decision', async () => {
    let request;
    const service = createJevService({
      apiKey: 'test-key',
      fetchImpl: async (_url, options) => {
        request = JSON.parse(options.body);
        return { ok: true, async json() { return { answers: { tool: { type: 'choice', choice: 'datasetSummary' } } }; } };
      },
    });
    const decision = await service.chooseTool({
      userRequest: 'Give me a summary.',
      dataset: { rows: 2, columns: [{ name: 'amount', type: 'number' }] },
      availableTools,
    });

    expect(decision).toEqual({ tool: 'datasetSummary' });
    expect(request.model).toBe('openjev-latest');
    expect(request.state.dataset.rows).toBe(2);
    expect(request.state).not.toHaveProperty('records');
    expect(request.questions.tool.type).toBe('choice');
    expect(Object.keys(request.questions.tool.criteria)).toEqual(['datasetSummary', 'review']);
  });

  it('rejects malformed or unknown JEV choices', async () => {
    const service = createJevService({
      apiKey: 'test-key',
      fetchImpl: async () => ({ ok: true, async json() { return { answers: { tool: { choice: 'run_code' } } }; } }),
    });
    await expect(service.chooseTool({ userRequest: 'x', dataset: {}, availableTools }))
      .rejects.toThrow('invalid tool decision');
  });

  it('reports provider failures without exposing credentials', async () => {
    const service = createJevService({
      apiKey: 'secret-value',
      fetchImpl: async () => { throw new Error('network unavailable'); },
    });
    await expect(service.chooseTool({ userRequest: 'x', dataset: {}, availableTools }))
      .rejects.toThrow('JEV request failed: network unavailable');
  });
});
