import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { PageHeader } from "@/components/ui";
import { SaleForm } from "@/components/SaleForm";

export const dynamic = "force-dynamic";

export async function SaleNewView() {
  await db();
  const customers = await Customer.find({ approvalStatus: "approved" })
    .sort({ name: 1 })
    .select({ name: 1 })
    .lean()
    .exec();

  return (
    <div>
      <PageHeader
        title="New Sale Entry"
        subtitle="Records a purchase and updates the customer's outstanding dues"
      />
      <SaleForm
        customers={customers.map((c) => ({
          id: String(c._id),
          name: c.name,
        }))}
      />
    </div>
  );
}
