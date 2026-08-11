import mongoose from "mongoose";

const StaticItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["folder", "file"],
      required: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaticItem",
      default: null,
    },
    url: {
      type: String,
      default: null,
    },
    size: {
      type: Number,
      default: null,
    },
    mimeType: {
      type: String,
      default: null,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Indexing for faster parent lookup
StaticItemSchema.index({ parentId: 1 });

export default mongoose.model("StaticItem", StaticItemSchema);
