"use client";

import { useEffect, Fragment } from "react";
import { X } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
}: ModalProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };

  return (
    <Fragment>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div
          className={`w-full ${sizeClasses[size]} rounded-2xl shadow-2xl ${
            isDark
              ? "bg-zinc-900 border-zinc-700"
              : "bg-white border-zinc-200"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`flex items-center justify-between px-6 py-4 border-b ${
            isDark ? "border-zinc-700" : "border-zinc-200"
          }`}>
            <h3 id="modal-title" className={`text-lg font-semibold ${
              isDark ? "text-zinc-100" : "text-zinc-900"
            }`}>
              {title}
            </h3>
            <button
              onClick={onClose}
              className={`p-1 rounded-lg transition-colors ${
                isDark
                  ? "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                  : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100"
              }`}
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="p-6 max-h-[70vh] overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </Fragment>
  );
}