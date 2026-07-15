import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { app } from "./server.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.RUNNER_PORT ?? 3001);

if (isProduction) {
  // Production mode: this same process serves both the API and the
  // pre-built client (packages/runner/dist), so `bun run start` is a single
  // deployable unit with no reverse proxy required. `serveStatic`'s `root`
  // is resolved relative to process.cwd(), which is packages/runner when
  // launched via `bun run start` from that package.
  app.use("/assets/*", serveStatic({ root: "./dist" }));

  app.get("*", async (c) => {
    try {
      const html = readFileSync(join(__dirname, "..", "dist", "index.html"), "utf-8");
      return c.html(html);
    } catch {
      return c.text("Build not found. Run `bun run build` first.", 404);
    }
  });
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[runner] server listening on http://localhost:${info.port}` +
      (isProduction ? " (production, serving dist/)" : " (api only, run vite for the client)"),
  );
});
