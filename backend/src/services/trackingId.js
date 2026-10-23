import Sequence from "../models/Sequence.js";

export async function createTrackingId(date = new Date()) {
  const year = date.getUTCFullYear();
  const sequence = await Sequence.findOneAndUpdate(
    { _id: `issue-${year}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true }
  );

  return `CP-${year}-${String(sequence.value).padStart(3, "0")}`;
}
