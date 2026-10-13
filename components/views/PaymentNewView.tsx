import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { Sale } from "@/lib/models/Sale";
import { Dropdown } from "@/lib/models/Dropdown";
import { PageHeader } from "@/components/ui";
import { PaymentForm } from "@/components/PaymentForm";
import { toDateInput } from "@/lib/format";
import type { SessionUser } from "@/lib/types";

export const dynamic = "force-dynamic";

async function optionsFor(
  type: "billCategory" | "paymentType" | "bankType" | "bankName" | "branch"
) {
  const docs = await Dropdown.find({ type })
    .sort({ value: 1 })
    .select({ value: 1 })
    .lean()
    .exec();
  return docs.map((d) => d.value);
}

export async function PaymentNewView({ user }: { user: SessionUser }) {
  await db();

  const customers = await Customer.find({ approvalStatus: "approved" })
    .sort({ name: 1 })
    .select({ name: 1, branch: 1 })
    .lean()
    .exec();

  // Oldest first so the form can auto-fill the customer's earliest (FIFO) bill
  const sales = await Sale.find()
    .sort({ saleDate: 1, referenceId: 1 })
    .limit(500)
    .select({ referenceId: 1, customerId: 1, billNo: 1, billDate: 1 })
    .lean()
    .exec();

  const [billCategories, paymentTypes, bankTypes, bankNames, branches] = await Promise.all([
    optionsFor("billCategory"),
    optionsFor("paymentType"),
    optionsFor("bankType"),
    optionsFor("bankName"),
    optionsFor("branch"),
  ]);

  return (
    <div>
      <PageHeader
        title="Payment Collection Entry"
        subtitle="Record a payment received from a customer"
      />
      <PaymentForm
        customers={customers.map((c) => ({
          id: String(c._id),
          name: c.name,
          branch: c.branch,
        }))}
        sales={sales.map((s) => ({
          referenceId: s.referenceId,
          customerId: String(s.customerId),
          billNo: s.billNo ?? "",
          billDate: toDateInput(s.billDate),
        }))}
        defaultPerson={user.name}
        billCategories={billCategories}
        paymentTypes={paymentTypes}
        bankTypes={bankTypes}
        bankNames={bankNames}
        branches={branches}
      />
    </div>
  );
}
