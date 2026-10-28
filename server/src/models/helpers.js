import mongoose from "mongoose";

const { Schema } = mongoose;

export const ref = (model, options = {}) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  ...options,
});

// Mongoose has no integer type. null and undefined pass, so optional limits can stay unset.
export const int = ({ min, max, ...options } = {}) => ({
  type: Number,
  ...(min !== undefined && { min }),
  ...(max !== undefined && { max }),
  validate: {
    validator: (v) => v == null || Number.isInteger(v),
    message: "{PATH} must be a whole number",
  },
  ...options,
});

export const maxItems = (n) => ({
  validator: (list) => list.length <= n,
  message: `{PATH} can have at most ${n} items`,
});

export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

// "entity.verb", e.g. "booking.approved". Used for audit actions and notification types.
export const EVENT_NAME = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

// Cloudinary asset: url for display, publicId for signed URLs and deletion.
export const photoSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
  },
  { _id: false },
);
