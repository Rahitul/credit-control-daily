import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { PendingBill } from "@/lib/models/PendingBill";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PendingBillForm, type PendingBillValues } from "@/components/PendingBillForm";
import { PendingBillImportButton } from "@/components/PendingBillImportButton";
import { getSession } from "@/lib/auth";
import { canWriteBill } from "@/lib/pendingBillsData";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PendingBillEditView({
  id,
  home,
  department,
}: {
  id: string;
  home: string;
  /**
   * The department app this URL belongs to, or null for Accounts/Admin. The
   * page is reachable by a hand-typed id, so a bill that is not in this app's
   * list is a 404 — the edit form must never render another app's register.
   */
  department?: Role | null;
}) {
  await db();

  const [bill, session, parties] = await Promise.all([
    PendingBill.findById(id).lean().exec(),
    getSession(),
    Customer.find()
      .sort({ name: 1 })
      .select({ name: 1 })
      .lean()
      .exec(),
  ]);

  if (!bill) {
    notFound();
  }
  if (department && !canWriteBill(session, bill.departments, bill.assignedTo)) {
    notFound();
  }

  const values: PendingBillValues & { id: string } = {
    id: String(bill._id),
    billDate: toDateInput(bill.billDate),
    referenceNo: bill.referenceNo,
    partyName: bill.partyName,
    openingAmount: bill.openingAmount,
    pendingAmount: bill.pendingAmount,
    dueOn: toDateInput(bill.dueOn),
    overdueDays: bill.overdueDays ?? 0,
    note: bill.note ?? "",
  };

  return (
    <div>
      <PageHeader
        title="Edit Pending Bill"
        subtitle={`${bill.referenceNo} · ${bill.partyName}`}
        actions={
          <>
            <PendingBillImportButton home={home} />
            {/* No query string → the whole register this app can see. */}
            <Link href={`${home}/pending-bills/export`} className="btn-ghost">
              Export
            </Link>
          </>
        }
      />
      <PendingBillForm
        mode="edit"
        home={home}
        bill={values}
        partySuggestions={parties.map((c) => c.name)}
      />
    </div>
  );
}
