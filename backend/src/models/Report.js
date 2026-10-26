const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['skill-gap', 'narrative', 'interview-qa', 'trajectory', 'retrieval-quality', 'weekly-summary'],
      required: true,
    },
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    body: { type: mongoose.Schema.Types.Mixed, default: {} }, // structured payload per kind
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    // which chunks/report ids this report consciously used (provenance)
    derivedFrom: [{ type: mongoose.Schema.Types.ObjectId }],
    autonomouslyGenerated: { type: Boolean, default: true },
  },
  { timestamps: true }
);

reportSchema.index({ kind: 1, createdAt: -1 });
reportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
