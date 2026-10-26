// Database connection layer. Supports a real MongoDB via MONGODB_URI, or a
// self-managed temporary in-memory instance (same engine the test suite uses)
// when KARMA_IN_MEMORY_DB=1 — so the full stack runs with zero local installs.

const mongoose = require('mongoose');

let memoryServer = null;
let inFlightConnect = null;

async function connectDb(uri, { inMemory = false, onMemoryStarted } = {}) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  // A connect() call is already in progress — wait for it instead of racing.
  if (mongoose.connection.readyState === 2 && inFlightConnect) return inFlightConnect;

  let finalUri = uri;

  if (inMemory || process.env.KARMA_IN_MEMORY_DB === '1') {
    // Serverless sandboxes (Vercel/Lambda) have a read-only or missing home dir;
    // mongodb-memory-server must download its binary into writable /tmp.
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      process.env.HOME = '/tmp';
      process.env.MONGOMS_DOWNLOAD_DIR = '/tmp/mongodb-binaries';
    }
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    finalUri = memoryServer.getUri();
    // eslint-disable-next-line no-console
    console.log(`[karma] self-started in-memory MongoDB at ${finalUri}`);
    if (onMemoryStarted) onMemoryStarted(finalUri);
  }

  inFlightConnect = mongoose.connect(finalUri, { serverSelectionTimeoutMS: inMemory ? 30000 : 5000 });
  try {
    await inFlightConnect;
  } finally {
    inFlightConnect = null;
  }
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

function dbStateLabel() {
  const stateMap = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return stateMap[mongoose.connection.readyState] || 'unknown';
}

async function isDbReachable() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.admin.ping();
    return true;
  } catch {
    return false;
  }
}

module.exports = { connectDb, disconnectDb, isDbReachable, dbStateLabel };
