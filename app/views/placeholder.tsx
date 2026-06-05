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
      <div class="mk-empty">
        <h2 class="mk-empty__title">{handle.props.heading}</h2>
        <p class="mk-empty__message">{handle.props.blurb}</p>
        <span class="mk-badge mt-2">coming soon</span>
      </div>
    </Layout>
  );
}
