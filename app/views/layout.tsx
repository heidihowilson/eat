/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Shared app chrome — the full nord-themed document with the precompiled CSS link
 * (cache-busted via CSS_VERSION), a phone-first bottom tab bar (Week / Ideas /
 * Groceries / Settings), and the external client script. Client JS stays external
 * because the ui renderer escapes inline <script> text.
 *
 * Usage from a feature page:
 *   import { Layout } from "../views/layout.tsx";
 *   return () => <Layout title="Week" active="week">{content}</Layout>;
 *
 * `active` highlights the current tab. `hideNav` (signup/login/onboarding) drops
 * the tab bar for pages shown before a household exists. Settings is adults-only;
 * pass `showSettings={role === "adult"}` to hide the tab for kids.
 */
import type { Handle, RemixNode } from "remix/ui";
import { CSS_VERSION } from "../render.tsx";
import { routes, staticUrl } from "../routes.ts";

export type Tab = "week" | "ideas" | "grocery" | "settings";

const NAV_STYLE = `
  .mobile-nav {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 50;
    display: flex; padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .mobile-nav a {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 2px; padding: 8px 0; min-height: 56px;
    text-decoration: none; font-size: 11px;
    transition: color 0.15s, background-color 0.15s;
    -webkit-tap-highlight-color: transparent;
  }
  .mobile-nav a:active { background-color: var(--color-base-300); }
`;

interface NavItem {
  tab: Tab;
  href: string;
  label: string;
  icon: RemixNode;
}

function Icon(handle: Handle<{ d: string }>) {
  return () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d={handle.props.d} />
    </svg>
  );
}

export function Layout(
  handle: Handle<{
    title: string;
    active?: Tab;
    showSettings?: boolean;
    hideNav?: boolean;
    children?: RemixNode;
  }>
) {
  return () => {
    const { active, hideNav } = handle.props;
    const showSettings = handle.props.showSettings ?? true;

    const items: NavItem[] = [
      { tab: "week", href: routes.week.index.href(), label: "Week", icon: <Icon d="M8 7V3m8 4V3M3 11h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" /> },
      { tab: "ideas", href: routes.ideas.index.href(), label: "Ideas", icon: <Icon d="M9 21h6M10 21v-3M14 21v-3M12 3a6 6 0 00-4 10.5c.7.6 1 1.2 1 2h6c0-.8.3-1.4 1-2A6 6 0 0012 3z" /> },
      { tab: "grocery", href: routes.grocery.index.href(), label: "Groceries", icon: <Icon d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 5h12M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z" /> },
    ];
    if (showSettings) {
      items.push({
        tab: "settings",
        href: routes.settings.index.href(),
        label: "Settings",
        icon: <Icon d="M10.3 3.2a1 1 0 011.4 0l.8.8a1 1 0 00.9.3l1.1-.2a1 1 0 011.1.7l.3 1.1a1 1 0 00.6.6l1.1.4a1 1 0 01.7 1.1l-.2 1.1a1 1 0 00.3.9l.8.8a1 1 0 010 1.4l-.8.8a1 1 0 00-.3.9l.2 1.1a1 1 0 01-.7 1.1l-1.1.4a1 1 0 00-.6.6l-.3 1.1a1 1 0 01-1.1.7l-1.1-.2a1 1 0 00-.9.3l-.8.8a1 1 0 01-1.4 0M12 9a3 3 0 100 6 3 3 0 000-6z" />,
      });
    }

    return (
      <html lang="en" data-theme="nord">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{`${handle.props.title} · eat`}</title>
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content="eat" />
          <link href={`${staticUrl("app.css")}?v=${CSS_VERSION}`} rel="stylesheet" type="text/css" />
          {hideNav ? "" : <style>{NAV_STYLE}</style>}
        </head>
        <body class={`min-h-screen bg-base-100 ${hideNav ? "" : "pb-[calc(5rem+env(safe-area-inset-bottom))]"}`}>
          <header class="sticky top-0 z-40 bg-base-200/95 backdrop-blur border-b border-base-300">
            <div class="flex items-center gap-2 h-14 px-4 max-w-3xl mx-auto">
              <a href={routes.week.index.href()} class="font-bold text-lg text-primary">
                🍽 eat
              </a>
              <h1 class="font-semibold text-base truncate ml-2 flex-1 text-base-content/80">{handle.props.title}</h1>
            </div>
          </header>

          <main class="max-w-3xl mx-auto px-3 py-4">{handle.props.children}</main>

          {hideNav ? (
            ""
          ) : (
            <nav aria-label="Primary" class="mobile-nav bg-base-200 border-t border-base-300">
              {items.map((it) => (
                <a
                  href={it.href}
                  class={active === it.tab ? "text-primary font-semibold" : "text-base-content/60 hover:text-primary"}
                >
                  {it.icon}
                  <span>{it.label}</span>
                </a>
              ))}
            </nav>
          )}
          <script src={staticUrl("app.js")}></script>
        </body>
      </html>
    );
  };
}

/**
 * Minimal centered-card shell for pre-household pages (signup / login / join /
 * onboarding). No nav, owns its own document.
 */
export function AuthShell(handle: Handle<{ title: string; children?: RemixNode }>) {
  return () => (
    <html lang="en" data-theme="nord">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{`${handle.props.title} · eat`}</title>
        <link href={`${staticUrl("app.css")}?v=${CSS_VERSION}`} rel="stylesheet" type="text/css" />
      </head>
      <body class="min-h-screen flex items-center justify-center bg-base-100 p-4">
        <div class="card bg-base-200 shadow-xl w-full max-w-sm">
          <div class="card-body">
            <h1 class="card-title text-2xl mb-2">🍽 eat</h1>
            {handle.props.children}
          </div>
        </div>
      </body>
    </html>
  );
}
