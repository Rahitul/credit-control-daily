"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2 } from "lucide-react";
import { importSales, type SaleImportResult } from "@/app/actions/saleImport";

export function SaleImportButton({ home }: { home: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SaleImportResult | undefined>();

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      setResult(await importSales(undefined, formData));
      input.value = "";
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Link href={`${home}/sales/export?template=1`} className="btn-ghost">
          <Download className="h-4 w-4" />
          Template
        </Link>
        <label className="btn-ghost cursor-pointer">
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileUp className="h-4 w-4" />
          )}
          <span>{pending ? "Importing…" : "Import…"}</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onPick}
            disabled={pending}
            className="sr-only"
          />
        </label>
      </div>
      {result ? <ImportReport result={result} /> : null}
    </div>
  );
}

function ImportReport({ result }: { result: SaleImportResult }) {
  if (!result.ok) {
    return (
      <div className="surface-card max-w-md p-3 text-xs text-rose-300">
        <p className="flex items-start gap-1.5 font-medium">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {result.error}
        </p>
      </div>
    );
  }

  const routing = Object.entries(result.routing);

  return (
    <div className="surface-card max-w-md p-3 text-xs">
      <p className="flex items-start gap-1.5 font-medium text-emerald-300">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {result.created} created · {result.updated} updated · {result.skipped} skipped
      </p>
      {routing.length ? (
        <p className="mt-1.5 text-zinc-400">
          Landed in:{" "}
          {routing.map(([label, n]) => `${n} → ${label}`).join(", ")}
        </p>
      ) : null}
      {result.mappingNote ? (
        <p className="mt-1 text-zinc-500">{result.mappingNote}</p>
      ) : null}
      {result.errors.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-rose-300">
            {result.errors.length} skipped row{result.errors.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-zinc-400">
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {result.warnings.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-amber-400">
            {result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""} (rows were still
            imported)
          </summary>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-zinc-400">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
