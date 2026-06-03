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
          class="input input-bordered input-sm flex-1 min-w-[8rem]"
        />
        <select name="tag" class="select select-bordered select-sm">
          <option value="" selected={tag === ""}>
            All tags
          </option>
          {allTags.map((t) => (
            <option value={t} selected={t === tag}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" class="btn btn-sm btn-primary">
          Filter
        </button>
        {q || tag ? (
          <a href={routes.ideas.index.href()} class="btn btn-sm btn-ghost">
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
    <div class="card bg-base-200 mb-4">
      <div class="card-body p-4 gap-2">
        <h2 class="font-semibold text-sm text-base-content/70">Add an idea</h2>
        {handle.props.error ? <div class="alert alert-error text-sm py-2">{handle.props.error}</div> : ""}
        <form method="POST" action={routes.ideas.create.href()} class="flex flex-col gap-2">
          <input name="name" type="text" required placeholder="Name (e.g. tacos)" class="input input-bordered input-sm w-full" />
          <input name="note" type="text" placeholder="Note (optional)" class="input input-bordered input-sm w-full" />
          <input name="recipe_url" type="url" placeholder="Recipe URL (optional)" class="input input-bordered input-sm w-full" />
          <input name="tags" type="text" placeholder="Tags, comma-separated (optional)" class="input input-bordered input-sm w-full" />
          <button type="submit" class="btn btn-sm btn-primary self-start">
            Add idea
          </button>
        </form>
      </div>
    </div>
  );
}

/** Inline edit form, hidden inside a native <details> (no JS needed to toggle). */
function EditIdea(handle: Handle<{ idea: IdeaView }>) {
  return () => {
    const i = handle.props.idea;
    return (
      <details class="mt-2">
        <summary class="cursor-pointer text-xs text-base-content/60 select-none">Edit</summary>
        <form method="POST" action={routes.ideas.update.href()} class="flex flex-col gap-2 mt-2">
          <input type="hidden" name="id" value={String(i.id)} />
          <input name="name" type="text" required value={i.name} class="input input-bordered input-sm w-full" />
          <input name="note" type="text" placeholder="Note" value={i.note ?? ""} class="input input-bordered input-sm w-full" />
          <input name="recipe_url" type="url" placeholder="Recipe URL" value={i.recipe_url ?? ""} class="input input-bordered input-sm w-full" />
          <input
            name="tags"
            type="text"
            placeholder="Tags, comma-separated"
            value={i.tags.join(", ")}
            class="input input-bordered input-sm w-full"
          />
          <div class="flex gap-2">
            <button type="submit" class="btn btn-sm btn-primary">
              Save
            </button>
          </div>
        </form>
      </details>
    );
  };
}

function IdeaCard(handle: Handle<{ idea: IdeaView }>) {
  return () => {
    const i = handle.props.idea;
    return (
      <li class="card bg-base-200">
        <div class="card-body p-4 gap-1">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-semibold">{i.name}</h3>
            {i.canEdit ? (
              <form
                method="POST"
                action={routes.ideas.remove.href()}
                data-confirm={`Delete "${i.name}"? Past plans keep working.`}
              >
                <input type="hidden" name="id" value={String(i.id)} />
                <button type="submit" class="btn btn-ghost btn-xs text-error" aria-label="Delete idea">
                  Delete
                </button>
              </form>
            ) : (
              ""
            )}
          </div>

          {i.note ? <p class="text-sm text-base-content/70">{i.note}</p> : ""}

          {i.recipe_url ? (
            <a href={i.recipe_url} target="_blank" rel="noopener noreferrer" class="link link-primary text-sm break-all">
              Recipe ↗
            </a>
          ) : (
            ""
          )}

          {i.tags.length ? (
            <div class="flex flex-wrap gap-1 mt-1">
              {i.tags.map((t) => (
                <span class="badge badge-outline badge-sm">{t}</span>
              ))}
            </div>
          ) : (
            ""
          )}

          <p class="text-xs text-base-content/50 mt-1">
            {i.lastPlanned ? `Last planned ${formatDate(i.lastPlanned)}` : "Never planned"}
          </p>

          {i.canEdit ? <EditIdea idea={i} /> : ""}
        </div>
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
        <div class="card bg-base-200">
          <div class="card-body items-center text-center py-10">
            <p class="text-base-content/60">
              {filtered ? "No ideas match your filter." : "No ideas yet. Add the first one above."}
            </p>
          </div>
        </div>
      );
    } else {
      list = (
        <ul class="flex flex-col gap-3">
          {ideas.map((i) => (
            <IdeaCard idea={i} />
          ))}
        </ul>
      );
    }

    return (
      <Layout title="Ideas" active="ideas" showSettings={role === "adult"}>
        <p class="text-sm text-base-content/60 mb-4">
          The shared backlog of meal ideas. Anyone can add; the planner pulls from it on Sunday.
        </p>
        <AddIdea error={createError} />
        <FilterBar q={q} tag={tag} allTags={allTags} />
        {list}
      </Layout>
    );
  };
}
