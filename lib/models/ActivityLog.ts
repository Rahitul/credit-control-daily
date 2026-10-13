import { Schema, model, models, type Model, type Types } from "mongoose";

export interface IActivityLog {
  _id: string;
  userId?: Types.ObjectId;
  userName?: string;
  action: string;
  module: string;
  recordId?: string;
  detail?: string;
  timestamp: Date;
}

const activityLogSchema = new Schema<IActivityLog>({
  userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  userName: { type: String },
  action: { type: String, required: true },
  module: { type: String, required: true },
  recordId: { type: String },
  detail: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
});

export const ActivityLog: Model<IActivityLog> =
  models.ActivityLog ?? model<IActivityLog>("ActivityLog", activityLogSchema);
