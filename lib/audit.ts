import { isValidObjectId, Types } from "mongoose";
import { ActivityLog } from "@/lib/models/ActivityLog";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/types";

export async function logActivity(entry: {
  user?: SessionUser | null;
  action: string;
  module: string;
  recordId?: string;
  detail?: string;
}): Promise<void> {
  try {
    await db();
    const uid = entry.user?.id;
    await ActivityLog.create({
      userId: uid && isValidObjectId(uid) ? new Types.ObjectId(uid) : undefined,
      userName: entry.user?.name ?? entry.user?.email,
      action: entry.action,
      module: entry.module,
      recordId: entry.recordId,
      detail: entry.detail,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("activity log failed", err);
  }
}
