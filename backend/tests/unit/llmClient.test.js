// Unit tests for the optional OpenAI-compatible LLM client.

const llm = require('../../src/services/llmClient');

describe('llmClient', () => {
  beforeEach(() => {
    llm.configure({ apiKey: null, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('reports unconfigured without a key and configured with one', () => {
    expect(llm.isConfigured()).toBe(false);
    llm.configure({ apiKey: 'sk-test' });
    expect(llm.isConfigured()).toBe(true);
    expect(llm.getConfig().apiKey).toBe('<set>'); // never leaks the key
  });

  it('complete() rejects when not configured', async () => {
    await expect(llm.complete('sys', 'user')).rejects.toThrow(/not configured/i);
  });

  it('complete() posts to the chat completions endpoint with an auth header', async () => {
    llm.configure({ apiKey: 'sk-test', baseUrl: 'https://llm.example.com/v1/', model: 'my-model' });
    const calls = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '  The grounded answer.  ' } }] }),
      };
    });

    const text = await llm.complete('system prompt', 'user prompt');
    expect(text).toContain('The grounded answer');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://llm.example.com/v1/chat/completions'); // trailing slash removed
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe('my-model');
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  it('complete() surfaces API errors as exceptions', async () => {
    llm.configure({ apiKey: 'sk-test' });
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    await expect(llm.complete('s', 'u')).rejects.toThrow('LLM API error 503');
  });

  it('complete() rejects when the response has no content', async () => {
    llm.configure({ apiKey: 'sk-test' });
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [] }) }));
    await expect(llm.complete('s', 'u')).rejects.toThrow('LLM returned no content');
  });
});
