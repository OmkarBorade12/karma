const mongoose = require('mongoose');

const experienceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    organization: { type: String, default: '' },
    kind: {
      type: String,
      enum: ['job', 'internship', 'project', 'education', 'certification', 'open-source', 'hackathon', 'personal'],
      default: 'project',
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    ongoing: { type: Boolean, default: false },
    description: { type: String, default: '' },
    skills: { type: [String], default: [] },
    highlights: { type: [String], default: [] },
    outcome: { type: String, default: '' },
  },
  { timestamps: true }
);

experienceSchema.index({ startDate: -1, createdAt: -1 });

module.exports = mongoose.model('Experience', experienceSchema);
