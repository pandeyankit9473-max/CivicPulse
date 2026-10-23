import mongoose from "mongoose";

const sequenceSchema = new mongoose.Schema({
  _id: { type: String },
  value: { type: Number, required: true, default: 0 }
});

export default mongoose.model("Sequence", sequenceSchema);
