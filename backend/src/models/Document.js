const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, required: true, maxlength: 500000 },
    sourceType: {
      type: String,
      enum: ['resume', 'project', 'experience', 'note', 'certificate', 'qa', 'insight', 'seed'],
      default: 'note',
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    chunkCount: { type: Number, default: 0 },
    // set true for documents created by the autopilot itself (self-augmentation)
    autonomouslyGenerated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

documentSchema.index({ sourceType: 1, createdAt: -1 });

documentSchema.virtual('chunks', {
  ref: 'Chunk',
  localField: '_id',
  foreignField: 'document',
});

module.exports = mongoose.model('Document', documentSchema);
