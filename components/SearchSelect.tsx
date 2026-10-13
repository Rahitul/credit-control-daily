"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

export type SearchOption = {
  value: string;
  label: string;
  /** Secondary text that is also searchable, e.g. a branch or code. */
  hint?: string;
};

/**
 * Searchable dropdown for long option lists (customers, parties…).
 *
 * A native `<select>` cannot be filtered, so with hundreds of customers you end
 * than scrolling a blind list. This keeps a REAL form value: the visible text
 * input is only the search box, and a hidden input named `name` carries the
 * selected `value` so `new FormData(form)` / the server action see the same
 * thing they always did. Swapping this in must not change what gets submitted.
 *
 * Pass NO `name` to use it as a pure picker (a "fill these other fields" helper)
 * — no hidden input is rendered, so it submits nothing.
 */
export function SearchSelect({
  name,
  options,
  value,
  onValueChange,
  placeholder = "Search...",
  emptyMessage = "No matches",
  required,
  className = "",
  disabled,
}: {
  name?: string;
  options: SearchOption[];
  value: string;
  onValueChange: (value: string, option: SearchOption | undefined) => void;
  placeholder?: string;
  emptyMessage?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!open || !q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)
    );
  }, [options, text, open]);

  // Clamp during render instead of in an effect (React Compiler forbids
  // setState-in-effect): the list can get shorter as the query narrows.
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setText(selected?.label ?? "");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, selected]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const commit = (option: SearchOption) => {
    setText(option.label);
    setOpen(false);
    onValueChange(option.value, option);
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setActive(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setActive((a) => {
        const n = matches.length;
        if (n === 0) return 0;
        return e.key === "ArrowDown" ? Math.min(a + 1, n - 1) : Math.max(a - 1, 0);
      });
      return;
    }
    if (e.key === "Enter") {
      const option = matches[activeIndex];
      if (open && option) {
        // Only swallow Enter when a row is actually highlighted, so the form
        // still submits on Enter when the box is closed or nothing matches.
        e.preventDefault();
        commit(option);
      }
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setText(selected?.label ?? "");
    }
  };

  const onBlur = () => {
    // A half-typed query that was never picked must not masquerade as a
    // selection, so snap the box back to the stored label (or empty). With
    // `required` that also stops the browser submitting an unmatched search.
    setOpen(false);
    setText(selected?.label ?? "");
  };

  const clear = () => {
    setText("");
    setOpen(true);
    setActive(0);
    onValueChange("", undefined);
    inputRef.current?.focus();
  };

  const toggleList = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      setText(selected?.label ?? "");
      return;
    }
    openList();
  };

  const panel = isDark
    ? "border-zinc-700 bg-zinc-900 shadow-black/50"
    : "border-zinc-200 bg-white shadow-zinc-200/80";
  const activeRow = isDark ? "bg-indigo-500/15" : "bg-indigo-50";
  const muted = isDark ? "text-zinc-500" : "text-zinc-400";

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          required={required}
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={openList}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className={`${className} pr-9`}
        />
        {text && !disabled ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            aria-label="Clear"
            className={`absolute top-1/2 right-8 -translate-y-1/2 cursor-pointer rounded p-0.5 ${muted} hover:text-rose-500`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleList}
          disabled={disabled}
          aria-label="Show options"
          tabIndex={-1}
          className={`absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer rounded p-0.5 ${muted} hover:text-indigo-500`}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* The real form value. The visible input is only a search box. Omitted
          when used as a picker, so the helper submits nothing. */}
      {name ? <input type="hidden" name={name} value={value} /> : null}

      {open ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className={`absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border py-1 shadow-xl ${panel}`}
        >
          {matches.length === 0 ? (
            <li className={`px-3 py-2.5 text-sm ${muted}`}>{emptyMessage}</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(o)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                  i === activeIndex ? activeRow : ""
                }`}
              >
                <Search className={`h-3.5 w-3.5 shrink-0 ${muted}`} />
                <span className="min-w-0 flex-1 truncate">
                  {o.label}
                  {o.hint ? <span className={`ml-1.5 text-xs ${muted}`}>{o.hint}</span> : null}
                </span>
                {o.value === value ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
