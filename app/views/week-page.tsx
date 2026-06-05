/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Week view (R2.*) — the app's home page. One dinner slot per day for the week
 * anchored to the household's week_start_day, prev/next week nav, an editable
 * slot form per day (adults only), the one-tap "we got takeout" on today, and the
 * takeout counter (used/target, planned vs unplanned).
 *
 * Phone-first: the week is a single vertical stack of day cards, each big enough
 * to tap one-handed. Kids get the same cards read-only (no forms/buttons).
 */
import type { Handle, RemixNode } from "remix/ui";
import { Layout } from "./layout.tsx";
import { routes } from "../routes.ts";
import type { Idea, SlotKind, Role } from "../db.ts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const KINDS: Array<{ value: SlotKind; label: string }> = [
  { value: "home", label: "Home" },
  { value: "takeout", label: "Takeout" },
  { value: "leftovers", label: "Leftovers" },
  { value: "out", label: "Eating out" },
];

const KIND_LABEL: Record<SlotKind, string> = {
  home: "Home",
  takeout: "Takeout",
  leftovers: "Leftovers",
  out: "Eating out",
};

/* Tonal badge per meal kind. There is no info hue in the system — leftovers
   (old badge-info) goes plain tonal like home; the label text disambiguates. */
const KIND_BADGE: Record<SlotKind, string> = {
  home: "",
  takeout: "mk-badge--warning",
  leftovers: "",
  out: "mk-badge--accent",
};

/** A single day's resolved plan, passed in from the controller. */
export interface DaySlot {
  date: string; // YYYY-MM-DD
  weekdayIndex: number; // 0=Sun..6=Sat (calendar weekday, for the label)
  dayOfMonth: number;
  monthIndex: number;
  isToday: boolean;
  ideaId: number | null;
  text: string | null;
  ideaName: string | null; // resolved name when ideaId is set (denormalized for display)
  kind: SlotKind;
  takeoutUnplanned: boolean;
}

export interface TakeoutCounter {
  used: number;
  planned: number;
  unplanned: number;
  target: number;
  over: boolean;
}

interface WeekProps {
  householdName: string;
  role: Role;
  weekLabel: string; // e.g. "Jun 1 – Jun 7"
  prevStart: string;
  nextStart: string;
  todayStart: string;
  isCurrentWeek: boolean;
  days: DaySlot[];
  ideas: Idea[];
  counter: TakeoutCounter;
}

function fmtDay(d: DaySlot): string {
  return `${WEEKDAYS[d.weekdayIndex]} ${MONTHS[d.monthIndex]} ${d.dayOfMonth}`;
}

/** Whether a slot has a concrete plan to show (a named meal, free text, or an
    unplanned-takeout tap — the latter has no text but still means "we ate out"). */
function slotFilled(d: DaySlot): boolean {
  const text = d.ideaName ?? d.text;
  return (text !== null && text !== "") || d.takeoutUnplanned;
}

/** Read-only summary of what's planned for a slot. */
function SlotSummary(handle: Handle<{ day: DaySlot }>) {
  return () => {
    const d = handle.props.day;
    const text = d.ideaName ?? d.text;
    // Unplanned takeout has no meal text but is still a plan: show "Takeout".
    const label = text !== null && text !== "" ? text : d.takeoutUnplanned ? "Takeout" : null;
    return (
      <div class="flex items-center gap-2 flex-wrap">
        {label !== null ? (
          <span class="font-medium">{label}</span>
        ) : (
          <span class="text-faint italic">No plan yet</span>
        )}
        {label !== null ? <span class={`mk-badge mk-badge--sm ${KIND_BADGE[d.kind]}`}>{KIND_LABEL[d.kind]}</span> : ""}
        {d.takeoutUnplanned ? <span class="mk-badge mk-badge--sm mk-badge--warning">unplanned</span> : ""}
      </div>
    );
  };
}

/** The adult edit form for one day's slot. Idea picker OR freeform text + kind. */
function SlotEditor(handle: Handle<{ day: DaySlot; ideas: Idea[] }>) {
  return () => {
    const d = handle.props.day;
    const ideas = handle.props.ideas;
    const listId = `ideas-${d.date}`;
    return (
      <form method="POST" action={routes.week.setSlot.href()} class="flex flex-col gap-2">
        <input type="hidden" name="date" value={d.date} />
        {/* Idea picker — a datalist over the household pool. Choosing one wins over
            free text (the controller prefers idea_id; see week.tsx). Leave blank to
            use the text field instead. Exactly one of the two is stored. */}
        <input
          name="idea"
          list={listId}
          placeholder="Pick from ideas, or type below…"
          value={d.ideaName ?? ""}
          class="mk-input"
          autocomplete="off"
        />
        <datalist id={listId}>
          {ideas.map((i) => (
            <option value={i.name}></option>
          ))}
        </datalist>
        <input
          name="text"
          type="text"
          placeholder="…or freeform (e.g. clean out the fridge)"
          value={d.ideaId === null ? d.text ?? "" : ""}
          class="mk-input"
          maxlength={200}
        />
        <div class="flex items-center gap-2">
          <select name="kind" class="mk-select flex-1 w-auto" aria-label="Meal kind">
            {KINDS.map((k) => (
              <option value={k.value} selected={k.value === d.kind}>
                {k.label}
              </option>
            ))}
          </select>
          <button type="submit" class="mk-btn mk-btn--primary">
            Save
          </button>
        </div>
      </form>
    );
  };
}

function DayCard(handle: Handle<{ day: DaySlot; ideas: Idea[]; role: Role; isCurrentWeek: boolean }>) {
  return () => {
    const { day: d, ideas, role, isCurrentWeek } = handle.props;
    const filled = slotFilled(d);
    return (
      <div
        class={`mk-card p-3 flex flex-col gap-1 ${
          // Today gets a tonal lift — an accent-subtle wash, no border/ring.
          d.isToday ? "bg-[var(--mk-color-accent-subtle)]" : ""
        }`}
      >
        <div class="flex items-center justify-between">
          <span class={`text-sm font-semibold ${d.isToday ? "text-accent" : "text-muted"}`}>
            {fmtDay(d)}
            {d.isToday ? <span class="mk-badge mk-badge--accent mk-badge--sm ml-2 align-middle">today</span> : ""}
          </span>
          {/* One-tap "we got takeout" — only adults, only today, only on the
              current week (R2.4). It overwrites the slot to an unplanned takeout. */}
          {role === "adult" && d.isToday && isCurrentWeek ? (
            <form method="POST" action={routes.week.gotTakeout.href()}>
              <input type="hidden" name="date" value={d.date} />
              <button type="submit" class="mk-btn mk-btn--sm text-warning">
                🥡 We got takeout
              </button>
            </form>
          ) : (
            ""
          )}
        </div>

        <SlotSummary day={d} />

        {role === "adult" ? (
          <details class="mk-disclosure mt-1">
            <summary class="text-xs">{filled ? "Edit" : "Plan this day"}</summary>
            <div class="mk-disclosure__body">
              <SlotEditor day={d} ideas={ideas} />
              {filled ? (
                <form method="POST" action={routes.week.clearSlot.href()} class="mt-2">
                  <input type="hidden" name="date" value={d.date} />
                  <button type="submit" class="mk-btn mk-btn--ghost mk-btn--sm text-danger" data-confirm="Clear this day's plan?">
                    Clear
                  </button>
                </form>
              ) : (
                ""
              )}
            </div>
          </details>
        ) : (
          ""
        )}
      </div>
    );
  };
}

function TakeoutCounterCard(handle: Handle<{ counter: TakeoutCounter }>) {
  return () => {
    const c = handle.props.counter;
    return (
      <div
        class={`mk-card p-3 flex flex-row items-center justify-between ${
          // Over target: a warning-subtle tonal wash + warning-colored number.
          // No border swap — borders don't exist in this design language.
          c.over ? "bg-[var(--mk-color-warning-subtle)]" : ""
        }`}
      >
        <div class="flex flex-col">
          <span class="text-xs uppercase tracking-wide text-muted">Takeout this week</span>
          <span class={`text-lg font-bold ${c.over ? "text-warning" : ""}`}>
            {c.used} / {c.target}
          </span>
          <span class="text-xs text-muted">
            {c.planned} planned · {c.unplanned} unplanned
          </span>
        </div>
        {c.over ? (
          <span class="text-sm text-warning font-medium max-w-[12rem] text-right">
            Over your target — no biggie, just a heads up. 🙂
          </span>
        ) : (
          <span class="text-2xl">🥡</span>
        )}
      </div>
    );
  };
}

/** Week navigation: prev / this-week / next, all via ?start=YYYY-MM-DD. */
function WeekNav(handle: Handle<{ weekLabel: string; prevStart: string; nextStart: string; todayStart: string; isCurrentWeek: boolean }>) {
  return () => {
    const p = handle.props;
    const href = (start: string) => `${routes.week.index.href()}?start=${start}`;
    return (
      <div class="flex items-center justify-between gap-2">
        <a href={href(p.prevStart)} class="mk-btn mk-btn--ghost mk-btn--sm" aria-label="Previous week">
          <span class="mk-icon mk-icon--sm icon-[mk--chevron-left]" aria-hidden="true"></span> Prev
        </a>
        <div class="flex flex-col items-center">
          <span class="font-semibold text-sm">{p.weekLabel}</span>
          {p.isCurrentWeek ? (
            <span class="text-xs text-faint">this week</span>
          ) : (
            <a href={href(p.todayStart)} class="text-xs">
              jump to today
            </a>
          )}
        </div>
        <a href={href(p.nextStart)} class="mk-btn mk-btn--ghost mk-btn--sm" aria-label="Next week">
          Next <span class="mk-icon mk-icon--sm icon-[mk--chevron-right]" aria-hidden="true"></span>
        </a>
      </div>
    );
  };
}

export function WeekPage(handle: Handle<WeekProps>) {
  const content: RemixNode = (() => {
    const p = handle.props;
    return (
      <div class="flex flex-col gap-3">
        <WeekNav
          weekLabel={p.weekLabel}
          prevStart={p.prevStart}
          nextStart={p.nextStart}
          todayStart={p.todayStart}
          isCurrentWeek={p.isCurrentWeek}
        />
        <TakeoutCounterCard counter={p.counter} />
        <div class="flex flex-col gap-2">
          {p.days.map((d) => (
            <DayCard day={d} ideas={p.ideas} role={p.role} isCurrentWeek={p.isCurrentWeek} />
          ))}
        </div>
      </div>
    );
  })();

  return () => (
    <Layout title={`Week · ${handle.props.householdName}`} active="week" showSettings={handle.props.role === "adult"}>
      {content}
    </Layout>
  );
}
