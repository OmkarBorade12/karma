// KARMA backend entrypoint.

require('dotenv').config();

const { connectDb, disconnectDb } = require('./config/db');
const { createApp } = require('./app');
const autopilot = require('./agent/autopilot');
const { ensureSeeded } = require('./services/bootstrap');
const llm = require('./services/llmClient');

const PORT = parseInt(process.env.PORT || '5001', 10);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/karma';

async function main() {
  // Optional LLM uplift: configure the OpenAI-compatible client from env.
  // Without a key the RAG engine runs fully-local extractive mode.
  llm.configure({
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  });
  if (llm.isConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`[karma] LLM uplift enabled (model: ${llm.getConfig().model})`);
  }

  let connected = false;
  if (process.env.KARMA_IN_MEMORY_DB !== '1') {
    try {
      await connectDb(MONGODB_URI);
      connected = true;
      // eslint-disable-next-line no-console
      console.log(`[karma] database connected (${MONGODB_URI})`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[karma] could not reach MongoDB at ${MONGODB_URI} (${err.message}). ` +
          'Falling back to a self-managed temporary in-memory instance (data lives for this process only). ' +
          'Set MONGODB_URI in backend/.env for persistence.'
      );
    }
  }
  if (!connected) {
    await connectDb(null, { inMemory: true });
  }

  await ensureSeeded();

  if (process.env.KARMA_AUTOPILOT_ENABLED === '1' || process.env.KARMA_AUTOPILOT_ENABLED === 'true') {
    const cronExpr = process.env.KARMA_AUTOPILOT_CRON || '*/15 * * * *';
    if (autopilot.scheduler.startScheduled(cronExpr)) {
      // eslint-disable-next-line no-console
      console.log(`[karma] autopilot scheduled (cron: ${cronExpr})`);
    }
  }

  const app = createApp();
  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[karma] api listening on http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.error(`[karma] port ${PORT} is already in use. Stop the other process or set PORT in backend/.env.`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.error('[karma] server error:', err.message);
  });

  async function shutdown(signal) {
    // eslint-disable-next-line no-console
    console.log(`[karma] ${signal} received, shutting down`);
    autopilot.scheduler.stopScheduled();
    await new Promise((resolve) => server.close(resolve));
    await disconnectDb();
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  process.on('unhandledRejection', (err) => {
    // eslint-disable-next-line no-console
    console.error('[karma] unhandled rejection:', err);
  });
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[karma] fatal startup error:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
