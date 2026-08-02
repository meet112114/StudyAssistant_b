import mongoose from "mongoose";

const SubjectSchema = new mongoose.Schema(
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
    semester: {
      type: String,
      enum: ["MCA Sem 1", "MCA Sem 2", "MCA Sem 3", "MCA Sem 4"],
      default: "MCA Sem 1",
    },
    resources: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Resource",
      }
    ]
  },
  { timestamps: true }
);

export default mongoose.model("Subject", SubjectSchema);
