import type { NextRequest } from "next/server";
import { handlePendingBillExport } from "@/lib/pendingBillsExport";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handlePendingBillExport(request, null);
}
