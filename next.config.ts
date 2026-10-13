import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The live server runs the build through PM2:
   * `.next/standalone/server.js` (see ecosystem.config.js + deploy scripts).
   * Without this, `.next/standalone` is never generated and steps 3-5 of
   * DEPLOYMENT.md have nothing to copy/start.
   */
  output: "standalone",
  experimental: {
    serverActions: {
      /**
       * Pending Bills Excel import posts a multipart .xlsx through a server
       * action. The default 1 MB is applied to the *raw* multipart body, so a
       * real register export would 413 before the action ever ran. 10 MB caps
       * it at roughly a few thousand rows; `IMPORT_MAX_ROWS` in
       * `lib/pendingBills.ts` is the real guard.
       */
      bodySizeLimit: "10mb",
    },
  },
  /**
   * exceljs resolves modules dynamically at runtime, so the bundler must leave
   * it alone. It is not in Next's auto-external list.
   */
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
