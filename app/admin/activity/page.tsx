import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActivityLog } from "@/lib/models/ActivityLog";
import { PageHeader, EmptyState } from "@/components/ui";
import {
  FilterBar,
  FilterLabel,
  fstr,
  hasAnyFilter,
  type SearchParams,
} from "@/components/filters";

export const dynamic = "force-dynamic";

function dayStart(v: string): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayEnd(v: string): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ACTIONS = ["create", "update", "delete", "login"] as const;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("admin");
  const params = await searchParams;
  const q = fstr(params, "q");
  const action = fstr(params, "action");
  const moduleName = fstr(params, "module");
  const userName = fstr(params, "userName");
  const dateFrom = fstr(params, "dateFrom");
  const dateTo = fstr(params, "dateTo");
  const sort = fstr(params, "sort") || "tsDesc";

  await db();

  const [modules, users] = await Promise.all([
    ActivityLog.distinct("module"),
    ActivityLog.distinct("userName", { userName: { $exists: true, $ne: null } }),
  ]);

  const query: Record<string, unknown> = {};
  if (action) query.action = action;
  if (moduleName) query.module = moduleName;
  if (userName) query.userName = userName;
  if (dateFrom || dateTo) {
    const timestamp: Record<string, Date> = {};
    const from = dayStart(dateFrom);
    const to = dayEnd(dateTo);
    if (from) timestamp.$gte = from;
    if (to) timestamp.$lte = to;
    query.timestamp = timestamp;
  }

  let logs = await ActivityLog.find(query).limit(500).lean().exec();

  if (q) {
    const needle = q.toLowerCase();
    logs = logs.filter((l) =>
      [l.userName ?? "", l.module, l.action, l.detail ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }

  logs = [...logs].sort((a, b) => {
    const at = new Date(a.timestamp).getTime();
    const bt = new Date(b.timestamp).getTime();
    return sort === "tsAsc" ? at - bt : bt - at;
  });

  return (
    <div>
      <PageHeader
        title="Activity Log"
        subtitle="Audit trail of every create, update, delete and login"
      />

      <FilterBar
        clearHref="/admin/activity"
        hasFilters={hasAnyFilter(params, [
          "q",
          "action",
          "module",
          "userName",
          "dateFrom",
          "dateTo",
          "sort",
        ])}
        search={
          <div className="w-full">
            <FilterLabel label="Search">
              <input
                name="q"
                defaultValue={q}
                placeholder="User, module, action…"
                className="input-field w-full"
              />
            </FilterLabel>
          </div>
        }
      >
        <FilterLabel label="Action">
          <select name="action" defaultValue={action} className="input-field w-36">
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Module">
          <select name="module" defaultValue={moduleName} className="input-field w-36">
            <option value="">All modules</option>
            {[...modules].sort().map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="User">
          <select name="userName" defaultValue={userName} className="input-field w-40">
            <option value="">Anyone</option>
            {[...users]
              .filter((u): u is string => !!u)
              .sort()
              .map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
          </select>
        </FilterLabel>
        <FilterLabel label="From">
          <input
            type="date"
            name="dateFrom"
            defaultValue={dateFrom}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="To">
          <input
            type="date"
            name="dateTo"
            defaultValue={dateTo}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Sort">
          <select name="sort" defaultValue={sort} className="input-field w-36">
            <option value="tsDesc">Newest</option>
            <option value="tsAsc">Oldest</option>
          </select>
        </FilterLabel>
      </FilterBar>

      <p className="mb-3 text-sm text-theme-muted">{logs.length} entries</p>

      {logs.length === 0 ? (
        <EmptyState message="No activity recorded yet." />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dark min-w-[800px]">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Module</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={String(l._id)}>
                    <td className="whitespace-nowrap text-xs text-zinc-500">
                      {new Date(l.timestamp).toLocaleString("en-GB")}
                    </td>
                    <td className="whitespace-nowrap font-medium text-zinc-100">
                      {l.userName ?? "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      <span
                        className={`pill ${
                          l.action === "delete"
                            ? "pill-red"
                            : l.action === "create"
                              ? "pill-green"
                              : l.action === "login"
                                ? "pill-indigo"
                                : "pill-zinc"
                        }`}
                      >
                        {l.action}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">{l.module}</td>
                    <td className="max-w-md truncate text-zinc-300">{l.detail ?? "—"}</td>
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
