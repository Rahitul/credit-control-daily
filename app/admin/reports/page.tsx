import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Payment } from "@/lib/models/Payment";
import { Sale } from "@/lib/models/Sale";
import { Customer } from "@/lib/models/Customer";
import { getCustomerCredits } from "@/lib/credit";
import { formatDate, toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ReportsClient, type ReportRow } from "@/components/ReportsClient";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireRole("admin");
  const params = await searchParams;
  const report =
    params.type === "sales" || params.type === "customers"
      ? params.type
      : "payments";

  await db();

  let rows: ReportRow[] = [];

  if (report === "payments") {
    const [payments, customers] = await Promise.all([
      Payment.find().sort({ rcvDate: -1 }).limit(1000).lean().exec(),
      Customer.find().select({ name: 1, category: 1 }).lean().exec(),
    ]);
    const map = new Map(customers.map((c) => [String(c._id), c]));
    rows = payments.map((p) => {
      const c = map.get(String(p.customerId));
      return {
        id: String(p._id),
        date: formatDate(p.rcvDate),
        isoDate: toDateInput(p.rcvDate),
        customer: c?.name ?? "—",
        department: c?.category ?? "Uncategorized",
        type: p.paymentType,
        ref: p.billNo ?? p.relatedSaleReferenceId,
        amount: p.rcvAmount,
        entryBy: p.entryBy,
      };
    });
  } else if (report === "sales") {
    const [sales, customers] = await Promise.all([
      Sale.find().sort({ saleDate: -1 }).limit(1000).lean().exec(),
      Customer.find().select({ name: 1, category: 1 }).lean().exec(),
    ]);
    const map = new Map(customers.map((c) => [String(c._id), c]));
    rows = sales.map((s) => {
      const c = map.get(String(s.customerId));
      return {
        id: String(s._id),
        date: formatDate(s.saleDate),
        isoDate: toDateInput(s.saleDate),
        customer: c?.name ?? "—",
        department: c?.category ?? "Uncategorized",
        type: "Sale",
        ref: s.referenceId,
        amount: s.amount,
        entryBy: s.entryBy,
      };
    });
  } else {
    const credits = await getCustomerCredits();
    rows = credits.map((r) => ({
      id: r.customerId,
      date: "—",
      customer: r.name,
      department: r.category ?? "Uncategorized",
      type: "Customer",
      ref: r.branch ?? "—",
      amount: r.outstanding,
      status: r.status === "overdue" ? "Overdue" : "Within Terms",
    }));
  }

  return (
    <div>
      <PageHeader title="Reports & Export" subtitle="Filter, export CSV, or print to PDF">
        <div className="flex gap-2">
          {(
            [
              ["payments", "Payments"],
              ["sales", "Sales"],
              ["customers", "Customers"],
            ] as const
          ).map(([key, label]) => (
            <a
              key={key}
              href={`/admin/reports?type=${key}`}
              className={`btn-ghost ${
                report === key
                  ? "!border-indigo-500/50 !text-white !bg-indigo-600/20"
                  : ""
              }`}
            >
              {label}
            </a>
          ))}
        </div>
      </PageHeader>

      <ReportsClient rows={rows} report={report} />
    </div>
  );
}
