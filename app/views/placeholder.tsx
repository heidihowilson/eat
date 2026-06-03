/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Scaffold placeholder page. Feature agents replace the body of their feature page
 * with the real UI; this just proves the route + layout + auth wiring works.
 */
import type { Handle } from "remix/ui";
import { Layout, type Tab } from "./layout.tsx";
import type { Role } from "../db.ts";

export function PlaceholderPage(
  handle: Handle<{ title: string; active: Tab; role: Role; heading: string; blurb: string }>
) {
  return () => (
    <Layout title={handle.props.title} active={handle.props.active} showSettings={handle.props.role === "adult"}>
      <div class="card bg-base-200">
        <div class="card-body items-center text-center py-12">
          <h2 class="card-title">{handle.props.heading}</h2>
          <p class="text-base-content/60 max-w-md">{handle.props.blurb}</p>
          <span class="badge badge-outline mt-2">coming soon</span>
        </div>
      </div>
    </Layout>
  );
}
