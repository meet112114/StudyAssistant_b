import mongoose from "mongoose";

const ResourcePackSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isVisible: { type: Boolean, default: true },
    subjects: [
      {
        originalSubjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
        name: { type: String, required: true },
        resources: [
          {
            name: { type: String, required: true },
            type: { type: String, enum: ["pdf", "docx", "txt"], required: true },
            size: { type: Number, required: true },
            url: { type: String, required: true },
            originalResourceId: { type: mongoose.Schema.Types.ObjectId, ref: "Resource" },
          }
        ]
      }
    ]
  },
  { timestamps: true }
);

export default mongoose.model("ResourcePack", ResourcePackSchema);
