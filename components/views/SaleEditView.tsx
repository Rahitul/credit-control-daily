import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { Sale } from "@/lib/models/Sale";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { SaleForm } from "@/components/SaleForm";
import { getSession } from "@/lib/auth";
import { canWriteSale } from "@/lib/pendingBillsData";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function SaleEditView({
  id,
  home,
  department,
}: {
  id: string;
  home: string;
  department?: Role | null;
}) {
  await db();

  const [sale, session, customers] = await Promise.all([
    Sale.findById(id).lean().exec(),
    getSession(),
    Customer.find()
      .sort({ name: 1 })
      .select({ _id: 1, name: 1 })
      .lean()
      .exec(),
  ]);

  if (!sale) {
    notFound();
  }
  if (department && !canWriteSale(session, sale.departments, sale.assignedTo)) {
    notFound();
  }

  return (
    <div>
      <PageHeader
        title="Edit Sale"
        subtitle={`${sale.referenceId} · ${sale.billNo}`}
        actions={
          <Link href={`${home}/sales`} className="btn-ghost">
            Back to Sales
          </Link>
        }
      />
      <SaleForm
        mode="edit"
        sale={{
          id: String(sale._id),
          customerId: String(sale.customerId),
          saleDate: toDateInput(sale.saleDate),
          amount: sale.amount,
          referenceId: sale.referenceId,
          billNo: sale.billNo,
          billDate: toDateInput(sale.billDate),
        }}
        customers={customers.map((c) => ({ id: String(c._id), name: c.name }))}
      />
    </div>
  );
}
