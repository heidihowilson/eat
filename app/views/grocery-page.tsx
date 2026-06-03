/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Grocery + snack list page (R4.1–R4.3).
 *
 * One shared grocery checklist plus this week's snack list, side by side. Adults
 * see the add/check/delete/clear/copy controls; kids get a read-only view (R1.5) —
 * the controls are simply not rendered for them, and the server re-checks the role
 * on every mutation, so hiding here is cosmetic, not the security boundary.
 *
 * No client JS: every action is a plain form POST that 303-redirects back here.
 * Check/uncheck is a one-button toggle form so it taps cleanly on a phone.
 */
import type { Handle, RemixNode } from "remix/ui";
import { Layout } from "./layout.tsx";
import { routes } from "../routes.ts";
import type { GroceryItem, SnackItem, Role } from "../db.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 1" from a YYYY-MM-DD anchor (parsed as UTC so it doesn't drift a day). */
function prettyWeek(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

/** A hidden-id POST form rendered as a single inline control (button text = children). */
function IdAction(
  handle: Handle<{ action: string; id: number; class?: string; confirm?: string; ariaLabel?: string; children?: RemixNode }>
) {
  return () => (
    <form
      method="POST"
      action={handle.props.action}
      class="inline"
      data-confirm={handle.props.confirm ?? ""}
    >
      <input type="hidden" name="id" value={String(handle.props.id)} />
      <button type="submit" class={handle.props.class ?? "btn btn-ghost btn-xs"} aria-label={handle.props.ariaLabel ?? ""}>
        {handle.props.children}
      </button>
    </form>
  );
}

function GroceryRow(handle: Handle<{ item: GroceryItem; canEdit: boolean }>) {
  return () => {
    const { item, canEdit } = handle.props;
    const checked = item.checked_at !== null && item.checked_at !== undefined;
    return (
      <li class="flex items-center gap-2 py-1.5 border-b border-base-300/60 last:border-0">
        {canEdit ? (
          // The whole "checkbox + label" is the toggle button: big tap target, no JS.
          <IdAction
            action={routes.grocery.toggle.href()}
            id={item.id}
            class="btn btn-ghost btn-sm justify-start flex-1 gap-3 font-normal normal-case"
            ariaLabel={checked ? `Uncheck ${item.text}` : `Check off ${item.text}`}
          >
            <span class={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "bg-primary border-primary text-primary-content" : "border-base-content/40"}`}>
              {checked ? "✓" : ""}
            </span>
            <span class={checked ? "line-through text-base-content/50" : ""}>{item.text}</span>
          </IdAction>
        ) : (
          // Kid (read-only): same visual, no button.
          <div class="flex items-center gap-3 flex-1 px-2">
            <span class={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "bg-primary border-primary text-primary-content" : "border-base-content/40"}`}>
              {checked ? "✓" : ""}
            </span>
            <span class={checked ? "line-through text-base-content/50" : ""}>{item.text}</span>
          </div>
        )}
        {canEdit ? (
          <IdAction
            action={routes.grocery.remove.href()}
            id={item.id}
            class="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
            ariaLabel={`Delete ${item.text}`}
          >
            ✕
          </IdAction>
        ) : (
          ""
        )}
      </li>
    );
  };
}

function SnackRow(handle: Handle<{ item: SnackItem; canEdit: boolean }>) {
  return () => {
    const { item, canEdit } = handle.props;
    return (
      <li class="flex items-center gap-2 py-1.5 border-b border-base-300/60 last:border-0">
        <span class="flex-1 px-2">{item.text}</span>
        {canEdit ? (
          <span class="flex items-center gap-1">
            <IdAction
              action={routes.grocery.copySnack.href()}
              id={item.id}
              class="btn btn-ghost btn-xs text-primary"
              ariaLabel={`Add ${item.text} to groceries`}
            >
              + groceries
            </IdAction>
            <IdAction
              action={routes.grocery.removeSnack.href()}
              id={item.id}
              class="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
              ariaLabel={`Delete snack ${item.text}`}
            >
              ✕
            </IdAction>
          </span>
        ) : (
          ""
        )}
      </li>
    );
  };
}

export function GroceryPage(
  handle: Handle<{ role: Role; items: GroceryItem[]; snacks: SnackItem[]; weekStart: string }>
) {
  return () => {
    const { role, items, snacks, weekStart } = handle.props;
    const canEdit = role === "adult";

    const unchecked = items.filter((i) => i.checked_at === null || i.checked_at === undefined);
    const checked = items.filter((i) => i.checked_at !== null && i.checked_at !== undefined);
    // Live (unchecked) items first, then the struck-through "already got it" pile.
    const ordered = [...unchecked, ...checked];

    return (
      <Layout title="Groceries" active="grocery" showSettings={canEdit}>
        <div class="flex flex-col gap-4">
          {/* ── Grocery checklist (R4.1/R4.3) ── */}
          <section class="card bg-base-200">
            <div class="card-body p-4 gap-3">
              <div class="flex items-center justify-between gap-2">
                <h2 class="card-title text-base">Grocery list</h2>
                {canEdit && checked.length > 0 ? (
                  <form method="POST" action={routes.grocery.clearChecked.href()} data-confirm={`Clear ${checked.length} checked item${checked.length === 1 ? "" : "s"}?`}>
                    <button type="submit" class="btn btn-ghost btn-xs">Clear checked ({checked.length})</button>
                  </form>
                ) : (
                  ""
                )}
              </div>

              {canEdit ? (
                <form method="POST" action={routes.grocery.add.href()} class="flex gap-2">
                  <input
                    name="text"
                    type="text"
                    required
                    maxlength={200}
                    placeholder="Add an item…"
                    class="input input-bordered input-sm flex-1"
                    autocomplete="off"
                  />
                  <button type="submit" class="btn btn-primary btn-sm">Add</button>
                </form>
              ) : (
                ""
              )}

              {ordered.length === 0 ? (
                <p class="text-sm text-base-content/50 py-2">
                  {canEdit ? "Nothing on the list yet. Add what you need above." : "The grocery list is empty."}
                </p>
              ) : (
                <ul class="list-none m-0 p-0">
                  {ordered.map((item) => (
                    <GroceryRow item={item} canEdit={canEdit} />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ── Weekly snack list (R4.2) ── */}
          <section class="card bg-base-200">
            <div class="card-body p-4 gap-3">
              <div class="flex items-baseline justify-between gap-2">
                <h2 class="card-title text-base">Snacks to have on hand</h2>
                <span class="text-xs text-base-content/50">week of {prettyWeek(weekStart)}</span>
              </div>

              {canEdit ? (
                <form method="POST" action={routes.grocery.addSnack.href()} class="flex gap-2">
                  <input
                    name="text"
                    type="text"
                    required
                    maxlength={200}
                    placeholder="Add a snack…"
                    class="input input-bordered input-sm flex-1"
                    autocomplete="off"
                  />
                  <button type="submit" class="btn btn-secondary btn-sm">Add</button>
                </form>
              ) : (
                ""
              )}

              {snacks.length === 0 ? (
                <p class="text-sm text-base-content/50 py-2">
                  {canEdit ? "No snacks for this week yet." : "No snacks listed for this week."}
                </p>
              ) : (
                <ul class="list-none m-0 p-0">
                  {snacks.map((item) => (
                    <SnackRow item={item} canEdit={canEdit} />
                  ))}
                </ul>
              )}
              {canEdit && snacks.length > 0 ? (
                <p class="text-xs text-base-content/40">Tap “+ groceries” to copy a snack onto the grocery list.</p>
              ) : (
                ""
              )}
            </div>
          </section>
        </div>
      </Layout>
    );
  };
}
