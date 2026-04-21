import mongoose from "mongoose";

const QnaItemSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  answer: { type: String, default: "" },
  isAnswered: { type: Boolean, default: false },
  answerSettings: {
    style: { type: String, enum: ["explanatory", "concise", "socratic", "stepbystep", "bullet"], default: "explanatory" },
    size: { type: String, enum: ["short", "medium", "long", "detailed"], default: "medium" },
    tone: { type: String, enum: ["simple", "professional", "friendly", "academic"], default: "professional" },
    language: { type: String, default: "english" },
  },
}, { _id: true });

const QnaSetSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    resources: [{ type: mongoose.Schema.Types.ObjectId, ref: "Resource" }],
    questions: [QnaItemSchema],
    totalQuestions: { type: Number, default: 0 },
    metadata: {
      description: { type: String, default: "" },
      tags: [{ type: String }],
      subject: { type: String, default: "" },
    },
    isPublic: { type: Boolean, default: false },
    // Default settings for the whole set (can be overridden per question)
    defaultSettings: {
      style: { type: String, enum: ["explanatory", "concise", "socratic", "stepbystep", "bullet"], default: "explanatory" },
      size: { type: String, enum: ["short", "medium", "long", "detailed"], default: "medium" },
      tone: { type: String, enum: ["simple", "professional", "friendly", "academic"], default: "professional" },
      language: { type: String, default: "english" },
    },
  },
  { timestamps: true }
);

// Keep totalQuestions in sync automatically
QnaSetSchema.pre("save", function () {
  this.totalQuestions = this.questions.length;
});

export default mongoose.model("QnaSet", QnaSetSchema);
