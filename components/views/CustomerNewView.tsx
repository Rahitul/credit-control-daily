import { db } from "@/lib/db";
import { Dropdown } from "@/lib/models/Dropdown";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "@/components/CustomerForm";

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

export async function CustomerNewView() {
  const { categories, branches } = await loadOptions();

  return (
    <div>
      <PageHeader
        title="Add Customer / Company"
        subtitle="Create a customer record with credit limit"
      />
      <CustomerForm categories={categories} branches={branches} />
    </div>
  );
}
