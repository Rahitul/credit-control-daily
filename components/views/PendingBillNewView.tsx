import Link from "next/link";
import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { PageHeader } from "@/components/ui";
import { PendingBillForm } from "@/components/PendingBillForm";
import { PendingBillImportButton } from "@/components/PendingBillImportButton";

export const dynamic = "force-dynamic";

/** Suggestions only — partyName stays free text so any client can be entered. */
async function loadPartySuggestions(): Promise<string[]> {
  await db();
  const docs = await Customer.find()
    .sort({ name: 1 })
    .select({ name: 1 })
    .lean()
    .exec();
  return docs.map((c) => c.name);
}

export async function PendingBillNewView({ home }: { home: string }) {
  const partySuggestions = await loadPartySuggestions();

  return (
    <div>
      <PageHeader
        title="Add Pending Bill"
        subtitle="Record an unpaid bill in the pending register"
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
      <PendingBillForm mode="create" home={home} partySuggestions={partySuggestions} />
    </div>
  );
}
