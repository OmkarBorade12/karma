const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema(
  {
    phase: { type: String, enum: ['discover', 'digest', 'augment'], required: true },
    action: { type: String, required: true },
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },
    success: { type: Boolean, default: true },
    durationMs: { type: Number, default: 0 },
  },
  { _id: false }
);

const agentRunSchema = new mongoose.Schema(
  {
    trigger: { type: String, enum: ['schedule', 'manual', 'boot'], default: 'manual' },
    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
    steps: { type: [stepSchema], default: [] },
    stats: {
      chunksIndexed: { type: Number, default: 0 },
      reportsCreated: { type: Number, default: 0 },
      documentsAugmented: { type: Number, default: 0 },
      questionsEvaluated: { type: Number, default: 0 },
    },
    issues: { type: [String], default: [] },
  },
  { timestamps: true }
);

agentRunSchema.index({ startedAt: -1 });

module.exports = mongoose.model('AgentRun', agentRunSchema);
