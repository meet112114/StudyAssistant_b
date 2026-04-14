import mongoose from "mongoose";

const EmbeddingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    resource: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resource",
      required: true,
    },
    textChunk: {
      type: String,
      required: true,
    },
    embeddingVector: {
      type: [Number],
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Embedding", EmbeddingSchema);
