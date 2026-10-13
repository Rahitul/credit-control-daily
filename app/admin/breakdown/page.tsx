import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Payment } from "@/lib/models/Payment";
import { formatBDT } from "@/lib/format";
import { PageHeader, BarChart, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BreakdownPage() {
  await requireRole("admin");
  await db();

  const [byType, byBank] = await Promise.all([
    Payment.aggregate<{ _id: string; total: number; count: number }>([
      { $group: { _id: "$paymentType", total: { $sum: "$rcvAmount" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Payment.aggregate<{ _id: string; total: number; count: number }>([
      {
        $group: {
          _id: { $ifNull: ["$bankType", "Cash / Other"] },
          total: { $sum: "$rcvAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]),
  ]);

  const grand = byType.reduce((s, t) => s + t.total, 0);

  return (
    <div>
      <PageHeader
        title="Payment Type & Bank Breakdown"
        subtitle={`Total collected ${formatBDT(grand)}`}
      />

      {byType.length === 0 && byBank.length === 0 ? (
        <EmptyState message="No payments recorded yet." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="surface-card p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-theme-muted">
              By Payment Type
            </h2>
            <BarChart
              data={byType.map((t) => ({ label: t._id ?? "Other", value: t.total }))}
            />
            <table className="table-dark mt-4">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="text-right">Entries</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((t) => (
                  <tr key={t._id}>
                    <td>{t._id}</td>
                    <td className="text-right">{t.count}</td>
                    <td className="text-right">{formatBDT(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="surface-card p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-theme-muted">
              By Bank Type
            </h2>
            <BarChart
              data={byBank.map((b) => ({ label: b._id ?? "Other", value: b.total }))}
            />
            <table className="table-dark mt-4">
              <thead>
                <tr>
                  <th>Bank</th>
                  <th className="text-right">Entries</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {byBank.map((b) => (
                  <tr key={b._id}>
                    <td>{b._id}</td>
                    <td className="text-right">{b.count}</td>
                    <td className="text-right">{formatBDT(b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
