/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Idea-pool views (R3.*).
 *
 * The page is a single GET /ideas: a search/filter bar, an "add idea" form (open
 * to ALL members incl. kids — R3.1), and the list of ideas. Each entry shows
 * name, note, recipe URL link, tags, and "last planned <date>" (R3.3). Owners
 * (and adults) get inline edit + delete controls (R3.4); delete is a soft delete
 * (R3.5) so past slots survive.
 *
 * Server-rendered, no hydration: every mutation is a POST form that 303-redirects
 * back here. The only client JS is the shared confirm-on-delete handler
 * (data-confirm) and the shared <details> edit toggle (native, no JS).
 */
import type { Handle, RemixNode } from "remix/ui";
import { Layout } from "./layout.tsx";
import { routes } from "../routes.ts";
import type { Role } from "../db.ts";

/** One idea, flattened for the view (tags already JSON-parsed, lastPlanned resolved). */
export interface IdeaView {
  id: number;
  name: string;
  note: string | null;
  recipe_url: string | null;
  tags: string[];
  created_by: number | null;
  lastPlanned: string | null; // YYYY-MM-DD or null (never planned)
  canEdit: boolean; // own entry, or viewer is an adult (R3.4)
}

function formatDate(iso: string): string {
  // iso is a YYYY-MM-DD slot date; render it human-friendly without TZ surprises.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Search + tag filter. GET form so the querystring stays shareable/bookmarkable. */
function FilterBar(handle: Handle<{ q: string; tag: string; allTags: string[] }>) {
  return () => {
    const { q, tag, allTags } = handle.props;
    return (
      <form method="GET" action={routes.ideas.index.href()} class="flex flex-wrap gap-2 mb-4">
        <input
          name="q"
          type="search"
          placeholder="Search ideas…"
          value={q}
          class="mk-input flex-1 min-w-[8rem] w-auto"
        />
        <select name="tag" class="mk-select w-auto">
          <option value="" selected={tag === ""}>
            All tags
          </option>
          {allTags.map((t) => (
            <option value={t} selected={t === tag}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" class="mk-btn mk-btn--primary">
          Filter
        </button>
        {q || tag ? (
          <a href={routes.ideas.index.href()} class="mk-btn mk-btn--ghost">
            Clear
          </a>
        ) : (
          ""
        )}
      </form>
    );
  };
}

/** Add form — open to every member (R3.1). name required; rest optional. */
function AddIdea(handle: Handle<{ error?: string | null }>) {
  return () => (
    <div class="mk-card p-4 flex flex-col gap-2 mb-4">
      <h2 class="text-sm font-semibold text-muted">Add an idea</h2>
      {handle.props.error ? <div class="mk-alert mk-alert--danger">{handle.props.error}</div> : ""}
      <form method="POST" action={routes.ideas.create.href()} class="flex flex-col gap-2">
        <input name="name" type="text" required placeholder="Name (e.g. tacos)" class="mk-input" />
        <input name="note" type="text" placeholder="Note (optional)" class="mk-input" />
        <input name="recipe_url" type="url" placeholder="Recipe URL (optional)" class="mk-input" />
        <input name="tags" type="text" placeholder="Tags, comma-separated (optional)" class="mk-input" />
        <button type="submit" class="mk-btn mk-btn--primary mk-btn--sm self-start">
          Add idea
        </button>
      </form>
    </div>
  );
}

/** Inline edit form, hidden inside a native <details> (no JS needed to toggle). */
function EditIdea(handle: Handle<{ idea: IdeaView }>) {
  return () => {
    const i = handle.props.idea;
    return (
      <details class="mk-disclosure mt-2">
        <summary class="text-xs">Edit</summary>
        <div class="mk-disclosure__body">
          <form method="POST" action={routes.ideas.update.href()} class="flex flex-col gap-2">
            <input type="hidden" name="id" value={String(i.id)} />
            <input name="name" type="text" required value={i.name} class="mk-input" />
            <input name="note" type="text" placeholder="Note" value={i.note ?? ""} class="mk-input" />
            <input name="recipe_url" type="url" placeholder="Recipe URL" value={i.recipe_url ?? ""} class="mk-input" />
            <input
              name="tags"
              type="text"
              placeholder="Tags, comma-separated"
              value={i.tags.join(", ")}
              class="mk-input"
            />
            <div class="flex gap-2">
              <button type="submit" class="mk-btn mk-btn--primary mk-btn--sm">
                Save
              </button>
            </div>
          </form>
        </div>
      </details>
    );
  };
}

function IdeaCard(handle: Handle<{ idea: IdeaView }>) {
  return () => {
    const i = handle.props.idea;
    return (
      <li class="mk-card p-4 flex flex-col gap-1">
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-base font-semibold">{i.name}</h3>
          {i.canEdit ? (
            <form
              method="POST"
              action={routes.ideas.remove.href()}
              data-confirm={`Delete "${i.name}"? Past plans keep working.`}
            >
              <input type="hidden" name="id" value={String(i.id)} />
              <button type="submit" class="mk-btn mk-btn--ghost mk-btn--sm text-danger" aria-label="Delete idea">
                Delete
              </button>
            </form>
          ) : (
            ""
          )}
        </div>

        {i.note ? <p class="text-sm text-muted">{i.note}</p> : ""}

        {i.recipe_url ? (
          <a href={i.recipe_url} target="_blank" rel="noopener noreferrer" class="text-sm break-all self-start">
            Recipe <span class="mk-icon mk-icon--sm icon-[mk--external]" aria-hidden="true"></span>
          </a>
        ) : (
          ""
        )}

        {i.tags.length ? (
          <div class="flex flex-wrap gap-1 mt-1">
            {i.tags.map((t) => (
              <span class="mk-badge mk-badge--sm">{t}</span>
            ))}
          </div>
        ) : (
          ""
        )}

        <p class="text-xs text-muted mt-1">
          {i.lastPlanned ? `Last planned ${formatDate(i.lastPlanned)}` : "Never planned"}
        </p>

        {i.canEdit ? <EditIdea idea={i} /> : ""}
      </li>
    );
  };
}

export function IdeasPage(
  handle: Handle<{
    role: Role;
    ideas: IdeaView[];
    q: string;
    tag: string;
    allTags: string[];
    createError?: string | null;
  }>
) {
  return () => {
    const { role, ideas, q, tag, allTags, createError } = handle.props;
    const filtered = q !== "" || tag !== "";

    let list: RemixNode;
    if (ideas.length === 0) {
      list = (
        <div class="mk-empty">
          <p class="mk-empty__message">
            {filtered ? "No ideas match your filter." : "No ideas yet. Add the first one above."}
          </p>
        </div>
      );
    } else {
      list = (
        <ul class="flex flex-col gap-3 list-none m-0 p-0">
          {ideas.map((i) => (
            <IdeaCard idea={i} />
          ))}
        </ul>
      );
    }

    return (
      <Layout title="Ideas" active="ideas" showSettings={role === "adult"}>
        <p class="text-sm text-muted mb-4">
          The shared backlog of meal ideas. Anyone can add; the planner pulls from it on Sunday.
        </p>
        <AddIdea error={createError} />
        <FilterBar q={q} tag={tag} allTags={allTags} />
        {list}
      </Layout>
    );
  };
}
