/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Week / weekly-plan feature module (R2.1–R2.5).
 *
 * OWNERSHIP: this module owns every /week* URL. It is mapped via registerRoutes()
 * from app/router.ts at boot; we never touch server.ts / app/router.ts. To add a
 * /week URL: add the leaf to routes.week in app/routes.ts, then add the matching
 * action key here.
 *
 * What this implements:
 *  - GET /week (?start=YYYY-MM-DD to navigate): the week grid anchored to the
 *    household's week_start_day, one dinner slot per day, prev/next week nav (R2.1).
 *  - POST /week/set-slot: adults upsert a day's dinner — pick an idea from the pool
 *    OR freeform text, plus kind home|takeout|leftovers|out (R2.2, R2.3). The
 *    unique(household_id, date, slot_type='dinner') row is upserted.
 *  - POST /week/clear-slot: adults wipe a day's plan.
 *  - POST /week/got-takeout: one-tap on TODAY's slot → kind=takeout,
 *    takeout_unplanned=1 (R2.4).
 *  - The takeout counter for the displayed week (used/target, planned vs
 *    unplanned, gentle over-target nudge — never blocks) (R2.5).
 *
 * Kids see everything read-only; all mutations are requireAdult + CSRF-guarded.
 *
 * NOTE ON SNACKS: routes.week also carries setSnack/deleteSnack leaves, but the
 * snack list (R4.2, "one snack list per week") is owned by the GROCERY feature
 * agent, not this one (my scope is R2.* dinner slots). Those two actions are kept
 * as adult-guarded no-op redirects so the controller satisfies every leaf in its
 * namespace without claiming snack behaviour that isn't mine to build.
 */
import { createController, type Router } from "remix/router";
import type { AppContext } from "../context.ts";
import { redirect } from "remix/response/redirect";
import * as s from "remix/data-schema";
import * as f from "remix/data-schema/form-data";
import { sql } from "remix/data-table";

import { routes } from "../routes.ts";
import { render } from "../render.tsx";
import { CurrentUserId, requireUser, requireAdult, requireSameOrigin } from "../auth.ts";
import { db, ideas as ideasTable, nowIso, type Idea, type SlotKind } from "../db.ts";
import { WeekPage, type DaySlot, type TakeoutCounter } from "../views/week-page.tsx";

// ============ DATE / WEEK MATH (UTC, date-only) ============
//
// Dates are stored as YYYY-MM-DD strings. We treat them as calendar dates in UTC
// to dodge DST/timezone drift — the household's week boundary is a calendar
// concept, not a wall-clock instant.

const DAY_MS = 24 * 60 * 60 * 1000;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse YYYY-MM-DD into a UTC-midnight Date; null if malformed. */
function parseIsoDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

/** Today at UTC midnight. */
function todayUtc(): Date {
  return parseIsoDate(toIsoDate(new Date()))!;
}

/** The start-of-week date (UTC midnight) for `ref`, given household week_start_day (0=Sun..6=Sat). */
function weekStartFor(ref: Date, weekStartDay: number): Date {
  const dow = ref.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow - weekStartDay + 7) % 7;
  return new Date(ref.getTime() - diff * DAY_MS);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function weekLabel(start: Date, end: Date): string {
  const a = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const b = `${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${a} – ${b}`;
}

// ============ FORM SCHEMAS ============

const slotKinds = ["home", "takeout", "leftovers", "out"] as const;

/** POST /week/set-slot — one of idea/text wins (idea preferred); kind defaults home. */
const setSlotForm = f.object({
  date: f.field(s.defaulted(s.string(), "")),
  idea: f.field(s.defaulted(s.string(), "").transform((v) => v.trim())),
  text: f.field(s.defaulted(s.string(), "").transform((v) => v.trim())),
  kind: f.field(s.defaulted(s.enum_(slotKinds), "home")),
});

/** POST /week/clear-slot and /week/got-takeout — just a date. */
const dateOnlyForm = f.object({
  date: f.field(s.defaulted(s.string(), "")),
});

// ============ DATA HELPERS (scoped to household; no schema change) ============

interface SlotRow {
  date: string;
  idea_id: number | null;
  text: string | null;
  kind: SlotKind;
  takeout_unplanned: number;
}

/** All dinner slots for a household within [start, end] inclusive (date strings). */
async function getDinnerSlots(householdId: number, start: string, end: string): Promise<SlotRow[]> {
  const result = await db.exec(sql`
    SELECT date, idea_id, text, kind, takeout_unplanned
    FROM slots
    WHERE household_id = ${householdId}
      AND slot_type = 'dinner'
      AND date >= ${start}
      AND date <= ${end}
  `);
  return (result.rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      date: String(row.date),
      idea_id: row.idea_id === null || row.idea_id === undefined ? null : Number(row.idea_id),
      text: row.text === null || row.text === undefined ? null : String(row.text),
      kind: row.kind as SlotKind,
      takeout_unplanned: Number(row.takeout_unplanned),
    };
  });
}

/** Non-deleted ideas for the household (idea picker source, R2.2). */
async function getActiveIdeas(householdId: number): Promise<Idea[]> {
  const result = await db.exec(sql`
    SELECT * FROM ideas
    WHERE household_id = ${householdId} AND deleted_at IS NULL
    ORDER BY name COLLATE NOCASE ASC
  `);
  return (result.rows ?? []) as Idea[];
}

/**
 * Upsert one dinner slot. UPSERT on the unique(household_id, date, slot_type) key
 * so re-planning a day overwrites it (R2.3, no history). Raw SQL because we write
 * explicit NULLs (db.update can't) and need ON CONFLICT.
 */
async function upsertDinnerSlot(input: {
  householdId: number;
  date: string;
  ideaId: number | null;
  text: string | null;
  kind: SlotKind;
  takeoutUnplanned: number;
  updatedBy: number;
}): Promise<void> {
  await db.exec(sql`
    INSERT INTO slots (household_id, date, slot_type, idea_id, text, kind, takeout_unplanned, updated_by, updated_at)
    VALUES (${input.householdId}, ${input.date}, 'dinner', ${input.ideaId}, ${input.text}, ${input.kind}, ${input.takeoutUnplanned}, ${input.updatedBy}, ${nowIso()})
    ON CONFLICT(household_id, date, slot_type) DO UPDATE SET
      idea_id = excluded.idea_id,
      text = excluded.text,
      kind = excluded.kind,
      takeout_unplanned = excluded.takeout_unplanned,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
}

async function clearDinnerSlot(householdId: number, date: string): Promise<void> {
  await db.exec(sql`
    DELETE FROM slots
    WHERE household_id = ${householdId} AND slot_type = 'dinner' AND date = ${date}
  `);
}

// ============ CONTROLLER ============

const weekController = createController(routes.week, {
  actions: {
    // GET /week — the household's week plan (?start=YYYY-MM-DD to navigate).
    async index({ get, url }) {
      const g = await requireUser(get(CurrentUserId));
      if (!g.ok) return g.response;
      const { household, role } = g.value;

      const today = todayUtc();
      // ?start may be any date in the target week; we re-anchor it to the
      // household's week_start_day so deep links / nav stay aligned.
      const ref = parseIsoDate(url.searchParams.get("start")) ?? today;
      const start = weekStartFor(ref, household.week_start_day);
      const end = addDays(start, 6);
      const startStr = toIsoDate(start);
      const endStr = toIsoDate(end);
      const todayStr = toIsoDate(today);
      const currentWeekStart = weekStartFor(today, household.week_start_day);

      const ideaList = await getActiveIdeas(household.id);
      const ideaById = new Map(ideaList.map((i) => [i.id, i]));
      const slotRows = await getDinnerSlots(household.id, startStr, endStr);
      const slotByDate = new Map(slotRows.map((r) => [r.date, r]));

      const days: DaySlot[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, i);
        const dateStr = toIsoDate(d);
        const slot = slotByDate.get(dateStr);
        const ideaId = slot?.idea_id ?? null;
        const ideaName = ideaId !== null ? ideaById.get(ideaId)?.name ?? null : null;
        days.push({
          date: dateStr,
          weekdayIndex: d.getUTCDay(),
          dayOfMonth: d.getUTCDate(),
          monthIndex: d.getUTCMonth(),
          isToday: dateStr === todayStr,
          ideaId,
          text: slot?.text ?? null,
          ideaName,
          kind: (slot?.kind ?? "home") as SlotKind,
          takeoutUnplanned: (slot?.takeout_unplanned ?? 0) === 1,
        });
      }

      // Takeout counter for the displayed week (R2.5).
      let planned = 0;
      let unplanned = 0;
      for (const r of slotRows) {
        if (r.kind === "takeout") {
          if (r.takeout_unplanned === 1) unplanned++;
          else planned++;
        }
      }
      const used = planned + unplanned;
      const counter: TakeoutCounter = {
        used,
        planned,
        unplanned,
        target: household.takeout_target,
        over: used > household.takeout_target,
      };

      return render(
        <WeekPage
          householdName={household.name}
          role={role}
          weekLabel={weekLabel(start, end)}
          prevStart={toIsoDate(addDays(start, -7))}
          nextStart={toIsoDate(addDays(start, 7))}
          todayStart={toIsoDate(currentWeekStart)}
          isCurrentWeek={startStr === toIsoDate(currentWeekStart)}
          days={days}
          ideas={ideaList}
          counter={counter}
        />
      );
    },

    // POST /week/set-slot — adults fill/edit a day (R2.2, R2.3). Exactly one of
    // idea_id / text is stored; an idea selection wins over freeform text.
    setSlot: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const { household, user } = g.value;

        const parsed = s.parseSafe(setSlotForm, get(FormData));
        const back = redirect(routes.week.index.href(), 303);
        if (!parsed.success) return back;
        const { date, idea, text, kind } = parsed.value;
        if (!parseIsoDate(date)) return back;

        // Resolve the idea name (if any) to an id within THIS household only —
        // never trust a client-supplied id; we match by name against the pool.
        let ideaId: number | null = null;
        let slotText: string | null = null;
        if (idea) {
          const match = await db.findOne(ideasTable, {
            where: { household_id: household.id, name: idea },
          });
          if (match) ideaId = (match as Idea).id;
          else slotText = idea; // typed something not in the pool → treat as freeform
        } else if (text) {
          slotText = text;
        }

        // Empty submission → nothing to plan; just bounce back.
        if (ideaId === null && (slotText === null || slotText === "")) return back;

        await upsertDinnerSlot({
          householdId: household.id,
          date,
          ideaId,
          text: ideaId === null ? slotText : null, // exactly one of idea/text
          kind: kind as SlotKind,
          takeoutUnplanned: 0, // a planned edit clears the unplanned flag
          updatedBy: user.id,
        });
        return back;
      },
    },

    // POST /week/clear-slot — adults wipe a day's plan.
    clearSlot: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const parsed = s.parseSafe(dateOnlyForm, get(FormData));
        const back = redirect(routes.week.index.href(), 303);
        if (!parsed.success || !parseIsoDate(parsed.value.date)) return back;
        await clearDinnerSlot(g.value.household.id, parsed.value.date);
        return back;
      },
    },

    // POST /week/got-takeout — one-tap unplanned takeout on TODAY only (R2.4).
    gotTakeout: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        const parsed = s.parseSafe(dateOnlyForm, get(FormData));
        const back = redirect(routes.week.index.href(), 303);
        if (!parsed.success || !parseIsoDate(parsed.value.date)) return back;

        // Only ever today's slot — the tap is "we got takeout [tonight]". Guard
        // server-side so a stale/forged form can't rewrite an arbitrary day.
        const todayStr = toIsoDate(todayUtc());
        if (parsed.value.date !== todayStr) return back;

        await upsertDinnerSlot({
          householdId: g.value.household.id,
          date: todayStr,
          ideaId: null,
          text: null,
          kind: "takeout",
          takeoutUnplanned: 1,
          updatedBy: g.value.user.id,
        });
        return back;
      },
    },

    // ── Snack leaves (NOT this feature). Owned by the grocery agent (R4.2). Kept
    //    as adult-guarded no-ops so the controller satisfies every routes.week
    //    leaf; the grocery agent will move/implement snack behaviour. ──
    setSnack: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        return redirect(routes.week.index.href(), 303);
      },
    },
    deleteSnack: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;
        return redirect(routes.week.index.href(), 303);
      },
    },
  },
});

/** Called once by app/router.ts at boot. */
export function registerRoutes(router: Router<AppContext>): void {
  router.map(routes.week, weekController);
}
