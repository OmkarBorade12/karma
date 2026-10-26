// Express app factory (kept separate from the listener for testability).

const express = require('express');
const cors = require('cors');

const apiRouter = require('./routes/api');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', apiRouter);

  // Unknown /api routes return structured JSON, not an HTML express 404.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` });
  });

  // JSON error handler — errors carrying err.status keep their status code
  // (validation 400s etc.); everything else becomes a 500.
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[karma][api] error:', err.message);
    const status = err.status || (err.name === 'ValidationError' ? 400 : 500);
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
