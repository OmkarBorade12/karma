// Optional LLM hook for answer synthesis. Works with any OpenAI-compatible API.
// When no key is configured the RAG engine runs in fully-local extractive mode.

let config = { apiKey: null, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };

// Self-configure from env at module load so serverless deployments (no main()
// boot) still get the LLM uplift from OPENAI_* environment variables.
function configureFromEnv() {
  configure({
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  });
}
configureFromEnv();

function configure({ apiKey, baseUrl, model } = {}) {
  if (apiKey !== undefined) config.apiKey = apiKey || null;
  if (baseUrl) config.baseUrl = baseUrl.replace(/\/$/, '');
  if (model) config.model = model;
}

function isConfigured() {
  return Boolean(config.apiKey);
}

async function complete(systemPrompt, userPrompt, { maxTokens = 700, temperature = 0.3, timeoutMs = 20000 } = {}) {
  if (!isConfigured()) throw new Error('LLM not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM API error ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('LLM returned no content');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { configure, isConfigured, complete, getConfig: () => ({ ...config, apiKey: config.apiKey ? '<set>' : null }) };
