import type { NextRequest } from "next/server";
import { handleCustomerExport } from "@/lib/customersExport";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleCustomerExport(request);
}
