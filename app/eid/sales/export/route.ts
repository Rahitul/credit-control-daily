import type { NextRequest } from "next/server";
import { handleSaleExport } from "@/lib/saleExport";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleSaleExport(request, "eid");
}
