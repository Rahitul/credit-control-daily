import Link from "next/link";
import { formatBDT } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { PendingBillImportButton } from "@/components/PendingBillImportButton";
import { PendingBillTableRow } from "@/components/PendingBillTableRow";
import {
  FilterBar,
  FilterLabel,
  fstr,
  hasAnyFilter,
  type SearchParams,
} from "@/components/filters";
import { selectPendingBills, PENDING_BILL_SORTS } from "@/lib/pendingBillsData";
import { BILL_ROUTES, toExportQueryString } from "@/lib/pendingBills";
import { Pagination } from "@/components/Pagination";
import { paginate, parsePage } from "@/lib/pagination";
import { getSession } from "@/lib/auth";
import { isSalesAllocated, DEPARTMENT_ROLES } from "@/lib/nav";
import { User } from "@/lib/models/User";
import { ROLE_LABELS, type Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILTER_KEYS = [
  "q",
  "party",
  "dateFrom",
  "dateTo",
  "year",
  "dueFrom",
  "dueTo",
  "minPending",
  "maxPending",
  "overdue",
  "minDays",
  "maxDays",
  "creditTerm",
  "dept",
  "route",
  "branch",
  "assigned",
  "warn",
  "promise",
  "promiseFrom",
  "promiseTo",
  "sort",
];

const SORT_LABELS: Record<string, string> = {
  dateDesc: "Date (new)",
  dateAsc: "Date (old)",
  dueAsc: "Due soonest",
  dueDesc: "Due latest",
  overdueDesc: "Overdue most",
  pendingDesc: "Pending high",
  pendingAsc: "Pending low",
  openingDesc: "Opening high",
  openingAsc: "Opening low",
  partyAsc: "Party A–Z",
  refAsc: "Ref A–Z",
  billNoAsc: "Bill no. A–Z",
  billNoDesc: "Bill no. Z–A",
  // Completed list only: the useful question is what closed, and when.
  completedDesc: "Settled (new)",
  completedAsc: "Settled (old)",
  openingDescCompleted: "Opening high",
  ageDesc: "Oldest bill first",
  ageAsc: "Newest bill first",
};

/**
 * `department` is the app this list is being rendered in. It scopes the query to
 * bills routed to that app; `null` (Accounts/Admin) means no routing filter, so
 * the consolidated view keeps showing every bill including unrouted ones.
 *
 * `completed` renders the same register filtered to SETTLED bills
 * (`pendingAmount <= 0`) instead of outstanding ones, which is what the Completed
 * Bills page is. One view rather than two, so the filters, the column layout and
 * the row actions can never drift apart between the two lists.
 */
export async function PendingBillsView({
  params,
  home,
  department = null,
  completed = false,
}: {
  params: SearchParams;
  home: string;
  department?: Role | null;
  completed?: boolean;
}) {
  const listPath = completed ? "/completed-bills" : "/pending-bills";
  const party = fstr(params, "party");
  const dateFrom = fstr(params, "dateFrom");
  const dateTo = fstr(params, "dateTo");
  const year = fstr(params, "year");
  const dueFrom = fstr(params, "dueFrom");
  const dueTo = fstr(params, "dueTo");
  const minPending = fstr(params, "minPending");
  const maxPending = fstr(params, "maxPending");
  const overdue = fstr(params, "overdue");
  const minDays = fstr(params, "minDays");
  const maxDays = fstr(params, "maxDays");
  const dept = fstr(params, "dept");
  const route = fstr(params, "route");
  const branch = fstr(params, "branch");
  const branchFilter = branch; // eslint-disable-line @typescript-eslint/no-unused-vars
  const assigned = fstr(params, "assigned");
  const warn = fstr(params, "warn");
  const promise = fstr(params, "promise");
  const promiseFrom = fstr(params, "promiseFrom");
  const promiseTo = fstr(params, "promiseTo");
  const sort = fstr(params, "sort") || (completed ? "completedDesc" : "dateDesc");
  const q = fstr(params, "q");
  const creditTerm = fstr(params, "creditTerm");

    const session = await getSession();
    const { rows, partyOptions, entryDeptOptions, creditTermOptions, branchOptions, yearOptions } =
      await selectPendingBills(params, department, completed, session);
  /**
   * The "Assigned To" column exists for the people doing the distributing. A
   * sales user only ever sees rows allocated to themselves, so the column would
   * repeat their own name down the table and is hidden for them.
   */
  const showAssignee = !isSalesAllocated(session?.roles ?? []);
  // Only fetched when the column is actually rendered, so the four department
  // apps that never show it pay nothing for it.
  const salesUsers = showAssignee
    ? await User.find({ role: "sales", status: "active" })
        .select({ _id: 1, name: 1 })
        .sort({ name: 1 })
        .lean()
        .exec()
    : [];

  const deptLabel = (key: string) =>
    key && key in ROLE_LABELS ? ROLE_LABELS[key as Role] : key || "Unknown";
  const hasUnknownDept = rows.some((b) => !b.createdByRole);

  // Totals come from the SAME final row set as the table, so the header, the
  // "N bills" count and the rows can never describe different data.
  const totalOpening = rows.reduce((s, x) => s + x.openingAmount, 0);
  const totalPending = rows.reduce((s, x) => s + x.pendingAmount, 0);
  const totalSettled = rows.reduce((s, x) => s + x.settledAmount, 0);
  const overdueCount = rows.filter((b) => b.overdueDays > 0).length;
  const warnCount = rows.filter((b) => b.warnings.length > 0).length;
  const unassignedCount = rows.filter((b) => !b.assignedTo).length;

  // Slice AFTER the totals above: they keep describing the full filtered set;
  // only the table body shows one page. Out-of-range pages clamp into range.
  // Applies to both the Pending and Completed lists (same view).
  const pager = paginate(rows, parsePage(fstr(params, "page")));

  const exportHref = `${home}${listPath}/export${toExportQueryString(
    params as Record<string, string | string[] | undefined>
  )}`;
  const scopeLabel = department ? ROLE_LABELS[department] : "all departments";

  /**
   * The department subtitle used to interpolate the `BILL_ROUTES` prefix that
   * routes to this app: "…bill numbers starting TS". `branches` has NO
   * `BILL_ROUTES` entry — it is routed by a branch prefix appearing anywhere in
   * the reference, not by a bill-number prefix — so that lookup returned
   * `undefined` and the sentence ended in a bare "starting ". Spelling the branch
   * app out keeps both pages truthful.
   */
  const departmentSubtitle = department === "branches" ? "branch-prefixed bills" : null;

  return (
    <div>
      <PageHeader
        title={completed ? "Completed Bills" : "Pending Bills"}
subtitle={
          completed
            ? department
              ? `Settled ${ROLE_LABELS[department]} bills — ${
                  departmentSubtitle ??
                  `bill numbers starting ${
                    BILL_ROUTES.find((r) => r.departments.includes(department))?.prefix ?? ""
                  }`
                }`
              : "Every bill that has been paid off, whichever department it is routed to"
            : department
              ? `Unpaid ${ROLE_LABELS[department]} bills — ${
                  departmentSubtitle ??
                  `bill numbers starting ${
                    BILL_ROUTES.find((r) => r.departments.includes(department))?.prefix ?? ""
                  }`
                }`
              : "Every unpaid bill, whichever department it is routed to"
        }
        actions={
          <>
            {/* Import creates new outstanding bills, so it has no meaning here. */}
            {completed ? null : <PendingBillImportButton home={home} />}
            <Link href={`${exportHref}`} className="btn-ghost">
              Export
            </Link>
            {completed ? (
              <Link href={`${home}/pending-bills`} className="btn-ghost">
                Back to Pending
              </Link>
            ) : (
              <Link href={`${home}/pending-bills/new`} className="btn-primary">
                New Pending Bill
              </Link>
            )}
          </>
        }
      />

      <FilterBar
        clearHref={`${home}${listPath}`}
        hasFilters={hasAnyFilter(params, FILTER_KEYS)}
        search={
          <div className="w-full">
            <FilterLabel label="Search">
              <input
                name="q"
                defaultValue={q}
                placeholder="Ref. no, bill no, party's name, note, entry by…"
                className="input-field w-full"
              />
            </FilterLabel>
          </div>
        }
      >
        <FilterLabel label="Party's Name">
          <select name="party" defaultValue={party} className="input-field w-44">
            <option value="">All parties</option>
            {partyOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Bill Date From">
          <input
            type="date"
            name="dateFrom"
            defaultValue={dateFrom}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Bill Date To">
          <input
            type="date"
            name="dateTo"
            defaultValue={dateTo}
            className="input-field w-40"
          />
        </FilterLabel>
        {/* Bill YEAR — a plain dropdown of the years the register actually
            contains (newest first), translated to a Jan 1 – Dec 31 window by
            the query. Composes with the date boxes and the age boxes rather
            than replacing them: overlapping bounds are intersected. */}
        <FilterLabel label="Bill Year">
          <select name="year" defaultValue={year} className="input-field w-32">
            <option value="">All years</option>
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Due On From">
          <input
            type="date"
            name="dueFrom"
            defaultValue={dueFrom}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Due On To">
          <input
            type="date"
            name="dueTo"
            defaultValue={dueTo}
            className="input-field w-40"
          />
        </FilterLabel>
        {/* On the completed list every bill has `pendingAmount === 0`, so a
            min/max pending box could only ever return "nothing" — offering it
            would be a trap. Due On is still a real stored column, so it stays. */}
        {completed ? null : (
          <>
            <FilterLabel label="Min Pending ৳">
              <input
                type="number"
                name="minPending"
                defaultValue={minPending}
                min="0"
                placeholder="0"
                className="input-field w-28"
              />
            </FilterLabel>
            <FilterLabel label="Max Pending ৳">
              <input
                type="number"
                name="maxPending"
                defaultValue={maxPending}
                min="0"
                placeholder="Any"
                className="input-field w-28"
              />
            </FilterLabel>
            {/* Overdue days is a manual figure the user typed while the bill was
                still open; it is not an aging, so it cannot describe a closed bill. */}
            <FilterLabel label="Status">
              <select name="overdue" defaultValue={overdue} className="input-field w-36">
                <option value="">All pending</option>
                <option value="only">Overdue only</option>
              </select>
            </FilterLabel>
          </>
        )}
        {/* Bill age = whole days from bill date to today. Min/max are translated
            into a bill-date window by the query, so the filter stays correct no
            matter when it is run. */}
        <FilterLabel label="Min Age (days)">
          <input
            type="number"
            name="minDays"
            defaultValue={minDays}
            min="0"
            placeholder="0"
            className="input-field w-28"
          />
        </FilterLabel>
        <FilterLabel label="Max Age (days)">
          <input
            type="number"
            name="maxDays"
            defaultValue={maxDays}
            min="0"
            placeholder="Any"
            className="input-field w-28"
          />
        </FilterLabel>
        {/* The bill's credit TERM in days: the gap from its date to its due
            date. A term, not a money limit: "30 days" means the bill falls due
            30 days after its date. Computed in the data layer and therefore
            filtered in JS, never in the bill query. */}
        <FilterLabel label="Credit Term">
          <select
            name="creditTerm"
            defaultValue={creditTerm}
            className="input-field w-36"
          >
            <option value="">All terms</option>
            {creditTermOptions.map((d) => (
              <option key={d} value={String(d)}>
                {d} day{d === 1 ? "" : "s"}
              </option>
            ))}
            <option value="unknown">No due date</option>
          </select>
        </FilterLabel>
        {/* `route` = where the bill is ROUTED (from its bill number).
            `dept`  = who ENTERED it. Two different questions, two params. */}
{department ? null : (
          <FilterLabel label="Routed To">
            <select name="route" defaultValue={route} className="input-field w-44">
              <option value="">All departments</option>
              {/* Driven by DEPARTMENT_ROLES, not BILL_ROUTES: `branches` is a real
                  routing target but has NO BILL_ROUTES entry (it is routed by a
                  branch prefix, not a bill-number prefix), so reading the options
                  off BILL_ROUTES would silently omit it and the control could not
                  filter to it. Same list the department apps are scoped by, so the
                  dropdown cannot drift from what is routable. */}
              {DEPARTMENT_ROLES.map((d) => (
                <option key={d} value={d}>
                  {ROLE_LABELS[d]}
                </option>
              ))}
              <option value="unrouted">Unrouted (Accounts only)</option>
            </select>
          </FilterLabel>
        )}
        {/* `branch` = WHICH BRANCH OFFICE, distinct from `route` (which app it is
            filed in): a `WO/…` bill carrying a branch prefix is routed to both
            EID and Branches, and this picks out the office. Options come from the
            register, not the active filters, so they cannot collapse on selection. */}
          <FilterLabel label="Branch">
            <select name="branch" defaultValue={branch} className="input-field w-44" disabled={!!session?.roles.includes("branches")}>
              <option value="">All branches</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value="unassigned">No branch</option>
            </select>
          </FilterLabel>
        <FilterLabel label="Entered by (Dept)">
          <select name="dept" defaultValue={dept} className="input-field w-44">
            <option value="">All departments</option>
            {entryDeptOptions.map((d) => (
              <option key={d} value={d}>
                {deptLabel(d)}
              </option>
            ))}
            {hasUnknownDept ? <option value="unknown">Unknown</option> : null}
          </select>
        </FilterLabel>
        {/* Work allocation. Accounts/Admin hand the sales register out row by row;
            a row with no assignee is waiting to be given to somebody, so
            "Unassigned" is the filter that finds work still to do. */}
        {showAssignee ? (
          <FilterLabel label="Assigned To">
            <select name="assigned" defaultValue={assigned} className="input-field w-44">
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {salesUsers.map((u) => (
                <option key={String(u._id)} value={String(u._id)}>
                  {u.name}
                </option>
              ))}
            </select>
          </FilterLabel>
        ) : null}
        <FilterLabel label="Warnings">
          <select name="warn" defaultValue={warn} className="input-field w-40">
            <option value="">Show all</option>
            <option value="only">Needs attention only</option>
          </select>
        </FilterLabel>
        {/* Promised payment date = the ETA the customer gave on their most recent
            follow-up. Only meaningful while a bill is still owed, so it is hidden
            on the completed list along with the follow-ups column. */}
        {completed ? null : (
          <>
            <FilterLabel label="Promise">
              <select name="promise" defaultValue={promise} className="input-field w-44">
                <option value="">Any promise</option>
                <option value="passed">Promise passed</option>
                <option value="upcoming">Promise upcoming</option>
                <option value="none">No promise yet</option>
              </select>
            </FilterLabel>
            <FilterLabel label="Promised From">
              <input
                type="date"
                name="promiseFrom"
                defaultValue={promiseFrom}
                className="input-field w-40"
              />
            </FilterLabel>
            <FilterLabel label="Promised To">
              <input
                type="date"
                name="promiseTo"
                defaultValue={promiseTo}
                className="input-field w-40"
              />
            </FilterLabel>
          </>
        )}
        <FilterLabel label="Sort">
          <select name="sort" defaultValue={sort} className="input-field w-44">
            {(completed
              ? PENDING_BILL_SORTS.filter((s) =>
                  s === "completedDesc" ||
                  s === "completedAsc" ||
                  s === "openingDescCompleted" ||
                  s === "partyAsc" ||
                  s === "dateDesc" ||
                  s === "dateAsc" ||
                  s === "refAsc" ||
                  s === "billNoAsc" ||
                  s === "billNoDesc"
                )
              : PENDING_BILL_SORTS
            ).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        </FilterLabel>
      </FilterBar>

      <p className="mb-3 text-sm text-zinc-500">
        {rows.length} bills · Opening{" "}
        <span className="font-medium text-zinc-200">{formatBDT(totalOpening)}</span> ·
        {completed ? (
          <>
            {" "}
            Settled{" "}
            <span className="font-medium text-emerald-300">{formatBDT(totalSettled)}</span>
          </>
        ) : (
          <>
            {" "}
            Pending{" "}
            <span className="font-medium text-amber-300">{formatBDT(totalPending)}</span>
          </>
        )}
        {!completed && overdueCount > 0 ? (
          <>
            {" · "}
            <span className="font-medium text-rose-300">{overdueCount} overdue</span>
          </>
        ) : null}
        {warnCount > 0 ? (
          <>
            {" · "}
            <Link href={`${home}${listPath}?warn=only`} className="font-medium text-amber-400 hover:underline">
              {warnCount} need attention
            </Link>
          </>
        ) : null}
        {showAssignee && unassignedCount > 0 ? (
          <>
            {" · "}
            <Link
              href={`${home}${listPath}?assigned=unassigned`}
              className="font-medium text-indigo-300 hover:underline"
            >
              {unassignedCount} unassigned
            </Link>
          </>
        ) : null}
        <span className="text-zinc-600"> · scope: {scopeLabel}</span>
      </p>

      {rows.length === 0 ? (
        <EmptyState
          message={
            completed
              ? department
                ? `No settled ${ROLE_LABELS[department]} bills yet. A bill moves here once an approved payment takes its pending amount to zero.`
                : "No completed bills yet. A bill moves here once an approved payment takes its pending amount to zero."
              : isSalesAllocated(session?.roles ?? [])
                ? // The single most confusing empty state in the app: the register is
                  // not empty, the user just has not been given any of it yet.
                  "Nothing has been assigned to you yet. Accounts or Admin distribute the sales register to you, and the bills you are responsible for appear here."
                : department
                  ? `No ${ROLE_LABELS[department]} bills found. ${
                      department === "branches"
                        ? "A bill appears here when its reference contains an active branch prefix."
                        : `A bill appears here when its bill number starts with ${BILL_ROUTES.find((r) => r.departments.includes(department))?.prefix ?? "a routed prefix"}.`
                    }`
                  : "No pending bills found. Bills appear here once they have an unpaid amount."
          }
        />
      ) : (
        <div className="surface-card overflow-hidden">
          {/* Fixed-height scroll box: the sticky header pins to its top edge and
              the horizontal scrollbar stays visible at its bottom edge. */}
          <div className="max-h-[70vh] overflow-x-auto">
            <table className="table-dark table-sticky min-w-[1380px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ref. No.</th>
                  <th>Bill Number</th>
                  {department ? null : <th>Routed To</th>}
                  <th>Branch</th>
                  <th>Party&apos;s Name</th>
                  {/* This bill's credit term in days — a payment TERM, not a
                      money limit: the gap from the bill date to its due date.
                      A bill with no due date renders "—". */}
                  <th title="Credit term in days: from this bill's date to its due date. A payment term, not a money limit.">
                    Credit Term
                  </th>
                  <th className="text-right">Opening Amount</th>
                  <th className="text-right">
                    {completed ? "Settled Amount" : "Pending Amount"}
                  </th>
                  {completed ? <th>Settled On</th> : <th>Due on</th>}
                  {completed ? <th>Settled By</th> : <th>Overdue by days</th>}
                  {!completed && <th className="text-right">Bill Age</th>}
                  {!completed && <th>Follow-ups</th>}
                  {!completed && <th>Promised</th>}
                  <th>Entry By</th>
                  {showAssignee ? <th>Assigned To</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody>
                {pager.pageRows.map((b) => (
                  <PendingBillTableRow
                    key={b.id}
                    bill={b}
                    completed={completed}
                    department={department}
                    home={home}
                    showAssignee={showAssignee}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            path={`${home}${listPath}`}
            params={params}
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            start={pager.start}
            end={pager.end}
          />
        </div>
      )}
    </div>
  );
}



