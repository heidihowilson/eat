/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Render helper — adapts ui server output to an HTML Response.
 *
 * createHtmlResponse already prepends `<!DOCTYPE html>` and sets
 * `Content-Type: text/html; charset=UTF-8`, so do NOT add either here.
 *
 * CSS_VERSION is a hash of the precompiled stylesheet, used to cache-bust the
 * `?v=` query in the layout's <link>.
 */
import { renderToString } from "remix/ui/server";
import { createHtmlResponse } from "remix/response/html";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RemixNode } from "remix/ui";

export const CSS_VERSION = (() => {
  try {
    const p = fileURLToPath(new URL("../public/static/app.css", import.meta.url));
    return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);
  } catch {
    return "0";
  }
})();

export async function render(node: RemixNode, init?: ResponseInit): Promise<Response> {
  return createHtmlResponse(await renderToString(node), init);
}
