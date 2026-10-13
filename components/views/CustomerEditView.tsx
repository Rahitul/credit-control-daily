import { notFound } from "next/navigation";
import { Types } from "mongoose";
import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { Dropdown } from "@/lib/models/Dropdown";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "@/components/CustomerForm";
import { getCustomerCredit } from "@/lib/credit";

export const dynamic = "force-dynamic";

async function loadOptions() {
  await db();
  const docs = await Dropdown.find()
    .sort({ type: 1, value: 1 })
    .select({ type: 1, value: 1 })
    .lean()
    .exec();

  return {
    categories: docs.filter((d) => d.type === "category").map((d) => d.value),
    branches: docs.filter((d) => d.type === "branch").map((d) => d.value),
  };
}

export async function CustomerEditView({ id }: { id: string }) {
  const { categories, branches } = await loadOptions();

  // The id is reachable by a hand-typed URL, and `findById` THROWS a CastError on
  // a malformed id rather than returning null — validate first so a bad id is a
  // clean 404 instead of a 500.
  if (!Types.ObjectId.isValid(id)) notFound();
  const customer = await Customer.findById(id).lean().exec();
  if (!customer) notFound();

  // Money summary for the read-only card at the bottom of the form. The row comes
  // from the same `getCustomerCredits` read the Customer list uses, so these figures
  // match it exactly. A customer the viewer cannot see (e.g. someone else's pending
  // customer) yields `null` and the card is simply omitted rather than showing a
  // misleading ৳0 — `getCustomerCredits()` without a `viewer` is approved-only.
  const credit = await getCustomerCredit(String(customer._id));
  const summary = credit
    ? {
        totalSales: credit.totalSales,
        billsOutstanding: credit.billsOutstanding,
        salesOutstanding: credit.salesOutstanding,
        totalCollected: credit.totalCollected,
        outstanding: credit.outstanding,
        status: credit.status,
        overdueAmount: credit.overdueAmount,
      }
    : undefined;
  // What the Customers list would show WITHOUT an override, so the helper text
  // can say what the blank override boxes are standing in for.
  const derivedTerm =
    credit && credit.billTermMin !== null && credit.billTermMax !== null
      ? credit.billTermMin === credit.billTermMax
        ? `${credit.billTermMin} d`
        : `${credit.billTermMin}–${credit.billTermMax} d`
      : null;

  return (
    <div>
      <PageHeader
        title={`Edit ${customer.name}`}
        subtitle="Update customer details, contact information and credit terms"
      />
      <CustomerForm
        mode="edit"
        categories={categories}
        branches={branches}
        summary={summary}
        derivedTerm={derivedTerm}
        customer={{
          id: String(customer._id),
          name: customer.name,
          address: customer.address,
          contactPerson: customer.contactPerson,
          contactNumber: customer.contactNumber,
          category: customer.category,
          group: customer.group,
          branch: customer.branch,
          creditLimitDays: customer.creditLimitDays ?? undefined,
          termMinDays: customer.termMinDays ?? null,
          termMaxDays: customer.termMaxDays ?? null,
        }}
      />
    </div>
  );
}
