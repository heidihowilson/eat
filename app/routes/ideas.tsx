/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Idea-pool feature module (R3.*).
 *
 * OWNERSHIP: owns every /ideas* URL. Filled in WITHOUT touching server.ts (it
 * calls registerRoutes() at boot). To add a /ideas URL: add the leaf to
 * routes.ideas in app/routes.ts, then the action here.
 *
 * Behaviour:
 *  - GET /ideas        list with text search (?q=) + tag filter (?tag=); each entry
 *                      shows name/note/recipe_url/tags and "last planned <date>"
 *                      (max slots.date where idea_id matches; omitted if never).
 *  - POST /ideas/create  add an idea — ALL members incl. kids (R3.1). name required;
 *                        note/recipe_url/tags optional. tags = comma-separated input
 *                        stored as a JSON array.
 *  - POST /ideas/update  edit an idea — own entry, or any if adult (R3.4).
 *  - POST /ideas/delete  soft delete (deleted_at) so past slots keep working (R3.5).
 *
 * Every query is scoped to g.value.household.id (tenancy seam). Mutations are
 * CSRF-guarded and 303-redirect back to /ideas (POST-redirect-GET, works w/o JS).
 * Validation failures redirect with a small ?err= flag rather than re-rendering,
 * so the list page always loads its full data on GET.
 */
import { createController, type Router } from "remix/router";
import type { AppContext } from "../context.ts";
import { redirect } from "remix/response/redirect";
import * as s from "remix/data-schema";
import * as f from "remix/data-schema/form-data";
import { sql } from "remix/data-table";

import { routes } from "../routes.ts";
import { render } from "../render.tsx";
import { CurrentUserId, requireUser, requireSameOrigin } from "../auth.ts";
import { db, ideas, nowIso, type Idea, type Role } from "../db.ts";
import { IdeasPage, type IdeaView } from "../views/ideas-page.tsx";

// ============ FORM SCHEMAS ============

const trimmed = () => s.defaulted(s.string(), "").transform((v) => v.trim());

/** Create: name (required, validated in handler), the rest optional text. */
const createForm = f.object({
  name: f.field(trimmed()),
  note: f.field(trimmed()),
  recipe_url: f.field(trimmed()),
  tags: f.field(trimmed()),
});

/** Update: same fields + the target id. */
const updateForm = f.object({
  id: f.field(s.defaulted(s.string(), "").transform((v) => Number(v.trim()))),
  name: f.field(trimmed()),
  note: f.field(trimmed()),
  recipe_url: f.field(trimmed()),
  tags: f.field(trimmed()),
});

/** Delete: just the id. */
const deleteForm = f.object({
  id: f.field(s.defaulted(s.string(), "").transform((v) => Number(v.trim()))),
});

// ============ HELPERS ============

/** Parse the "a, b,c ,," tags input into a clean, de-duped string array. */
function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/** Read the JSON tags column off an idea row, tolerating null/garbage. */
function readTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** Normalize empty string → null for nullable optional columns. */
function nullIfEmpty(v: string): string | null {
  return v === "" ? null : v;
}

/**
 * Load the household's non-deleted ideas joined to their "last planned" date
 * (max slots.date referencing the idea). Search + tag filter applied in SQL.
 * tag is matched against the JSON array via a json_each subquery so partial
 * substring matches on the JSON text can't produce false hits.
 */
async function loadIdeas(householdId: number, q: string, tag: string): Promise<Array<Idea & { last_planned: string | null }>> {
  const like = `%${q.toLowerCase()}%`;
  const result = await db.exec(sql`
    SELECT i.*,
           (SELECT MAX(sl.date) FROM slots sl WHERE sl.idea_id = i.id) AS last_planned
    FROM ideas i
    WHERE i.household_id = ${householdId}
      AND i.deleted_at IS NULL
      AND (${q} = '' OR lower(i.name) LIKE ${like} OR lower(COALESCE(i.note, '')) LIKE ${like})
      AND (${tag} = '' OR EXISTS (
        SELECT 1 FROM json_each(COALESCE(i.tags, '[]')) je WHERE je.value = ${tag}
      ))
    ORDER BY i.created_at DESC, i.id DESC
  `);
  return (result.rows ?? []) as Array<Idea & { last_planned: string | null }>;
}

/** Distinct tags across the household's live ideas, for the filter dropdown. */
async function loadAllTags(householdId: number): Promise<string[]> {
  const result = await db.exec(sql`
    SELECT DISTINCT je.value AS tag
    FROM ideas i, json_each(COALESCE(i.tags, '[]')) je
    WHERE i.household_id = ${householdId} AND i.deleted_at IS NULL
    ORDER BY je.value COLLATE NOCASE ASC
  `);
  return (result.rows ?? []).map((r) => String((r as Record<string, unknown>).tag));
}

/** Fetch a live idea scoped to the household (null if missing/deleted/other-tenant). */
async function getLiveIdea(id: number, householdId: number): Promise<Idea | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const idea = (await db.find(ideas, id)) as Idea | undefined;
  if (!idea || idea.household_id !== householdId || idea.deleted_at) return null;
  return idea;
}

/** R3.4 ownership: the creator may edit/delete their own; adults may edit/delete any. */
function canEdit(idea: Idea, userId: number, role: Role): boolean {
  return role === "adult" || idea.created_by === userId;
}

// ============ CONTROLLER ============

const ideasController = createController(routes.ideas, {
  actions: {
    // GET /ideas — view + filter the pool (all members, including kids).
    async index({ get, url }) {
      const g = await requireUser(get(CurrentUserId));
      if (!g.ok) return g.response;
      const { user, household, role } = g.value;

      const q = (url.searchParams.get("q") ?? "").trim();
      const tag = (url.searchParams.get("tag") ?? "").trim();
      const createError = url.searchParams.get("err") === "name" ? "A name is required." : null;

      const [rows, allTags] = await Promise.all([loadIdeas(household.id, q, tag), loadAllTags(household.id)]);

      const ideaViews: IdeaView[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        note: row.note,
        recipe_url: row.recipe_url,
        tags: readTags(row.tags),
        created_by: row.created_by,
        lastPlanned: row.last_planned,
        canEdit: canEdit(row, user.id, role),
      }));

      return render(
        <IdeasPage role={role} theme={user.theme} ideas={ideaViews} q={q} tag={tag} allTags={allTags} createError={createError} />
      );
    },

    // POST /ideas/create — open to ALL members (R3.1): requireUser, not requireAdult.
    create: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireUser(get(CurrentUserId));
        if (!g.ok) return g.response;
        const { user, household } = g.value;

        const parsed = s.parseSafe(createForm, get(FormData));
        if (!parsed.success || parsed.value.name === "") {
          return redirect(`${routes.ideas.index.href()}?err=name`, 303);
        }
        const { name, note, recipe_url, tags } = parsed.value;

        await db.create(
          ideas,
          {
            household_id: household.id,
            name,
            note: nullIfEmpty(note) ?? undefined,
            recipe_url: nullIfEmpty(recipe_url) ?? undefined,
            tags: JSON.stringify(parseTags(tags)),
            created_by: user.id,
            created_at: nowIso(),
            updated_at: nowIso(),
          },
          { returnRow: false }
        );
        return redirect(routes.ideas.index.href(), 303);
      },
    },

    // POST /ideas/update — own entry, or any if adult (R3.4). Ownership enforced here.
    update: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireUser(get(CurrentUserId));
        if (!g.ok) return g.response;
        const { user, household, role } = g.value;

        const parsed = s.parseSafe(updateForm, get(FormData));
        if (!parsed.success) return redirect(routes.ideas.index.href(), 303);
        const { id, name, note, recipe_url, tags } = parsed.value;
        if (name === "") return redirect(`${routes.ideas.index.href()}?err=name`, 303);

        const idea = await getLiveIdea(id, household.id);
        if (!idea || !canEdit(idea, user.id, role)) return redirect(routes.ideas.index.href(), 303);

        // Raw SQL: db.update can't write explicit NULL, and note/recipe_url are nullable.
        await db.exec(sql`
          UPDATE ideas
          SET name = ${name},
              note = ${nullIfEmpty(note)},
              recipe_url = ${nullIfEmpty(recipe_url)},
              tags = ${JSON.stringify(parseTags(tags))},
              updated_at = ${nowIso()}
          WHERE id = ${idea.id} AND household_id = ${household.id}
        `);
        return redirect(routes.ideas.index.href(), 303);
      },
    },

    // POST /ideas/delete — soft delete (R3.5) so past slots survive. Own, or adult any.
    remove: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireUser(get(CurrentUserId));
        if (!g.ok) return g.response;
        const { user, household, role } = g.value;

        const parsed = s.parseSafe(deleteForm, get(FormData));
        if (!parsed.success) return redirect(routes.ideas.index.href(), 303);

        const idea = await getLiveIdea(parsed.value.id, household.id);
        if (!idea || !canEdit(idea, user.id, role)) return redirect(routes.ideas.index.href(), 303);

        // Soft delete: set deleted_at instead of db.delete so slots referencing this
        // idea keep working (their idea_id FK stays valid; "last planned" history lives).
        await db.exec(sql`
          UPDATE ideas SET deleted_at = ${nowIso()} WHERE id = ${idea.id} AND household_id = ${household.id}
        `);
        return redirect(routes.ideas.index.href(), 303);
      },
    },
  },
});

export function registerRoutes(router: Router<AppContext>): void {
  router.map(routes.ideas, ideasController);
}
