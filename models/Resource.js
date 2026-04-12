import mongoose from "mongoose";

const ResourceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
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
    type: {
      type: String,
      enum: ["pdf", "docx", "txt"],
      required: true,
    },
    AIprocesses: {
      type: Boolean,
      default: false,
    },
    embeddingCreated: {
      type: Boolean,
      default: false,
    },
    size: {
      type: Number,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Resource", ResourceSchema);
