/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Shared app chrome — the full document with the precompiled CSS link
 * (cache-busted via CSS_VERSION), a phone-first bottom tab bar (Week / Ideas /
 * Groceries / Settings), and the external client script. Client JS stays external
 * because the ui renderer escapes inline <script> text.
 *
 * Styling is the sethmakes design system (mk-* classes + tokens); Tailwind
 * utilities handle layout only. Color mode follows the OS (light-dark() tokens)
 * unless the user picked an explicit theme in Settings — then `theme` lands as
 * data-theme on <html> and the tokens' [data-theme] overrides force the mode.
 * "system" (the default) renders no attribute.
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
import type { Theme } from "../db.ts";

export type Tab = "week" | "ideas" | "grocery" | "settings";

/** data-theme value for <html>: undefined (omit the attribute) for "system". */
function themeAttr(theme: Theme | undefined): "light" | "dark" | undefined {
  return theme === "light" || theme === "dark" ? theme : undefined;
}

interface NavItem {
  tab: Tab;
  href: string;
  label: string;
  icon: string; // brand-icon utility class (the scanner reads comments too — don't write bracketed icon names here)
}

export function Layout(
  handle: Handle<{
    title: string;
    active?: Tab;
    showSettings?: boolean;
    hideNav?: boolean;
    theme?: Theme;
    children?: RemixNode;
  }>
) {
  return () => {
    const { active, hideNav } = handle.props;
    const showSettings = handle.props.showSettings ?? true;

    const items: NavItem[] = [
      { tab: "week", href: routes.week.index.href(), label: "Week", icon: "icon-[mk--calendar]" },
      { tab: "ideas", href: routes.ideas.index.href(), label: "Ideas", icon: "icon-[mk--lightbulb]" },
      { tab: "grocery", href: routes.grocery.index.href(), label: "Groceries", icon: "icon-[mk--cart]" },
    ];
    if (showSettings) {
      items.push({
        tab: "settings",
        href: routes.settings.index.href(),
        label: "Settings",
        icon: "icon-[mk--settings]",
      });
    }

    return (
      <html lang="en" data-theme={themeAttr(handle.props.theme)}>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{`${handle.props.title} · eat`}</title>
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content="eat" />
          <link href={`${staticUrl("app.css")}?v=${CSS_VERSION}`} rel="stylesheet" type="text/css" />
        </head>
        {/* Flex column so the sticky bottom appbar's flow slot is the bottom of
            the (≥viewport-high) body even on short pages. */}
        <body class="min-h-screen flex flex-col">
          <header class="mk-appbar">
            <div class="flex items-center gap-2 max-w-3xl mx-auto w-full min-h-8">
              <a href={routes.week.index.href()} class="mk-link-reset font-bold text-lg text-accent">
                🍽 eat
              </a>
              <h1 class="font-semibold text-base truncate ml-2 flex-1 text-muted">{handle.props.title}</h1>
            </div>
          </header>

          <main class="max-w-3xl mx-auto px-3 py-4 w-full flex-1">{handle.props.children}</main>

          {hideNav ? (
            ""
          ) : (
            <nav aria-label="Primary" class="mk-appbar mk-appbar--bottom">
              {items.map((it) => (
                <a
                  href={it.href}
                  class={`mk-link-reset flex-1 flex flex-col items-center justify-center gap-1 min-h-[56px] text-[11px] ${
                    active === it.tab ? "text-accent font-semibold" : "text-muted hover:text-accent"
                  }`}
                >
                  <span class={`mk-icon mk-icon--lg ${it.icon}`} aria-hidden="true"></span>
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
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{`${handle.props.title} · eat`}</title>
        <link href={`${staticUrl("app.css")}?v=${CSS_VERSION}`} rel="stylesheet" type="text/css" />
      </head>
      <body class="min-h-screen flex items-center justify-center p-4">
        <div class="mk-card w-full max-w-sm">
          <h1 class="text-2xl mb-2">🍽 eat</h1>
          {handle.props.children}
        </div>
      </body>
    </html>
  );
}
