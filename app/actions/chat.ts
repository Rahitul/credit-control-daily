"use server";

import { requireRole } from "@/lib/auth";
import { ENTRY_ROLES } from "@/lib/nav";
import { parseQuery } from "@/lib/chat/parse";
import { answerQuery } from "@/lib/chat/answer";

export type ChatActionResult = {
  ok: boolean;
  answer?: string;
  error?: string;
};

export async function askAssistant(
  _prev: ChatActionResult | undefined,
  formData: FormData
): Promise<ChatActionResult> {
  try {
    const user = await requireRole(...ENTRY_ROLES, "admin");
    const message = String(formData.get("message") ?? "").trim();

    if (!message) {
      return { ok: false, error: "Type a question first." };
    }
    if (message.length > 500) {
      return { ok: false, error: "Question is too long (max 500 characters)." };
    }

    const parsed = parseQuery(message);
    const answer = await answerQuery(parsed, user);
    return { ok: true, answer };
  } catch (err) {
    console.error("askAssistant", err);
    return { ok: false, error: "Could not answer that right now. Try again." };
  }
}
