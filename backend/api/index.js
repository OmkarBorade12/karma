// Vercel serverless entrypoint: one warm Express instance per lambda instance,
// with a cached DB connection. Falls back to an in-memory MongoDB when no
// MONGODB_URI is configured (demo mode — data resets per instance).

const { createApp } = require('../src/app');
const { connectDb } = require('../src/config/db');
const { ensureSeeded } = require('../src/services/bootstrap');

const app = createApp();
let readyPromise = null;

function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (process.env.MONGODB_URI) {
        await connectDb(process.env.MONGODB_URI);
      } else {
        await connectDb(null, { inMemory: true });
      }
      await ensureSeeded();
      return app;
    })().catch((err) => {
      readyPromise = null; // allow the next invocation to retry
      throw err;
    });
  }
  return readyPromise;
}

module.exports = async (req, res) => {
  try {
    await ready();
    return app(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[karma][vercel] boot error:', err.message);
    res.status(503).json({ error: 'KARMA API is starting up — try again shortly', detail: err.message });
  }
};
