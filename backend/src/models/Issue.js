import mongoose from "mongoose";

export const ISSUE_STATUSES = ["New", "Acknowledged", "In Progress", "Resolved"];

const issueSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 4,
      maxlength: 120
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    category: {
      type: String,
      enum: ["Pothole", "Garbage", "Streetlight", "Road Damage", "Water", "Other"],
      required: true
    },
    location: {
      address: { type: String, trim: true, default: "" },
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 }
    },
    photos: {
      type: [String],
      default: [],
      validate: {
        validator: (photos) => photos.length <= 4,
        message: "A report can include up to 4 photos"
      }
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium"
    },
    priorityScore: { type: Number, min: 0, max: 100, default: 30 },
    priorityReasons: { type: [String], default: [] },
    trackingId: { type: String, unique: true, sparse: true, trim: true },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    pointsAwarded: { type: Number, min: 0, default: 0 },
    supporters: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: []
    },
    supportCount: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: ISSUE_STATUSES,
      default: "New"
    },
    statusHistory: {
      type: [{
        status: { type: String, enum: ISSUE_STATUSES, required: true },
        changedAt: { type: Date, required: true },
        changedBy: { type: String, trim: true, default: "System" }
      }],
      default: []
    }
  },
  { timestamps: true }
);

issueSchema.index({ createdAt: -1 });
issueSchema.index({ status: 1, category: 1 });
issueSchema.index({ category: 1, status: 1, createdAt: -1 });

export default mongoose.model("Issue", issueSchema);
