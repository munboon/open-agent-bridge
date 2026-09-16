import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { '/api/admin/[[...path]]': ['./LICENSE','./scripts/quiet-session.mjs','./scripts/kit-prompts.mjs','./scripts/kit-workspace.mjs','./scripts/kit-tui.mjs','./node_modules/next/dist/compiled/ws/index.js','./node_modules/next/dist/compiled/ws/LICENSE','./scripts/host-metrics.mjs','./scripts/quiet-transfer.mjs','./helpers/transfer_server.py','./helpers/check_archive.py','./helpers/tunnel_process.py'] },
};

export default config;
