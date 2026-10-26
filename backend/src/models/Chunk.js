const mongoose = require('mongoose');

const chunkSchema = new mongoose.Schema(
  {
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    indexInDoc: { type: Number, required: true },
    heading: { type: String, default: null },
    text: { type: String, required: true },
    sourceTitle: { type: String, required: true },
    sourceType: { type: String, required: true },
    // sparse term-frequency vector {stemmedTerm: count} — IDF applied at query time
    terms: { type: mongoose.Schema.Types.Mixed, required: true },
    tokenCount: { type: Number, required: true },
  },
  { timestamps: true }
);

chunkSchema.index({ document: 1 });
chunkSchema.index({ sourceType: 1, createdAt: 1 });

module.exports = mongoose.model('Chunk', chunkSchema);
