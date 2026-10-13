"use client";

import { useEffect, useState } from "react";
import {
  getPartyPendingBills,
  type PartyBillsResult,
} from "@/app/actions/pendingBills";

/**
 * Outstanding pending bills for the selected customer.
 *
 * Fetched ONCE and shared by the picker and the read-only summary card, so
 * selecting a customer does not run the same query twice. The payload is tagged
 * with the id it belongs to, so a slow response for a previously-picked customer
 * can never be shown against the current one, and switching customers shows a
 * loader instead of the old party's figures.
 */
export function usePartyPendingBills(customerId: string) {
  const [loaded, setLoaded] = useState<{ id: string; data: PartyBillsResult } | null>(null);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    void getPartyPendingBills(customerId).then((data) => {
      if (!cancelled) setLoaded({ id: customerId, data });
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return {
    data: loaded?.id === customerId ? loaded.data : null,
    loading: customerId !== "" && loaded?.id !== customerId,
  };
}
