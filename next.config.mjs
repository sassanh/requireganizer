import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

/**
 * The interface builds to static files. A page build (the default) runs the
 * project in the page and exports to `out/`. A server build
 * (NEXT_PUBLIC_PROJECT_HOST=server) is served by the project server, so it
 * exports next to the server's bundle, in `dist/ui/`, and develops in its
 * own directory, so both kinds of dev server can run at once.
 */
export default function nextConfig(phase) {
  const serverBuild = process.env.NEXT_PUBLIC_PROJECT_HOST === "server";
  /** @type {import('next').NextConfig} */
  const config = {
    output: "export",
    ...(serverBuild && {
      distDir: phase === PHASE_PRODUCTION_BUILD ? "dist/ui" : ".next-server",
    }),
  };
  return config;
}
