# eat — Product Definition

A web app that kills the 5pm "what's for dinner?" scramble by making the household's
dinner plan decided ahead of time, visible to everyone, and easy to adjust when life happens.

## The problem

Nobody decides dinner until it's too late. The decision lands at 5pm, under pressure,
and resolves into stress or takeout. The fix isn't a recipe database or a smart fridge —
it's a **weekly ritual** that makes the decision once, in advance, with the whole family's
input available when it happens.

## Who it's for

- **v1:** one household (ours). Adults and kids, each with their own account.
- **Later:** any household. The data model is tenancy-ready from day one
  (households are first-class; users join via invite links), but v1 ships no
  signup marketing, no onboarding polish, no multi-household admin.

## Roles

- **Adults** — edit the plan, manage the grocery list, manage household settings, invite members.
- **Kids** — add to the idea pool and view everything. No editing the plan or settings.

## The core loop

1. **All week:** anyone tosses meal ideas into the shared **idea pool**
   ("tacos", "that soup from the blue cookbook", a recipe URL).
2. **Sunday (configurable):** an adult runs the **weekly planning ritual** —
   fills the week's dinner slots by pulling from the idea pool or typing freeform,
   schedules the week's **takeout nights** up front, jots the weekly **snack list**,
   and builds the **grocery list** alongside.
3. **All week:** everyone can see what's for dinner. No 5pm scramble.
4. **When life happens:** an adult swaps a slot, or one-taps **"we got takeout"** —
   which logs an *unplanned* takeout against the household's weekly takeout target.

## Key concepts

| Concept | What it is |
|---|---|
| **Dinner slot** | One per day (v1 is dinner-only). Holds freeform text *or* a link to an idea-pool entry, plus a kind: home / takeout / leftovers / eating out. |
| **Idea pool** | Standing household backlog of meal ideas: name, optional note, optional recipe URL, optional tags. Shows "last planned on …" so the planner avoids tacos three weeks running. No voting, no ratings. |
| **Takeout target** | Household setting: N takeout nights/week. Takeout is planned during the ritual; unplanned takeout (the one-tap) also counts. Counter is informational — the app nudges, never blocks or scolds. |
| **Grocery list** | A shared manual checklist that lives next to the plan. **Not generated** from meals — meals carry no ingredients in v1. |
| **Snack list** | A simple per-week "have on hand" list (fruit, crackers, hummus). Not calendar slots. Items can be one-tap copied to the grocery list. |
| **Week** | Anchored to a configurable start day, default Sunday. Drives the planning view and the takeout counter. |

## Explicitly out of scope for v1

| Cut | Why / when it returns |
|---|---|
| Notifications (daily "tonight's dinner", planning nag) | Web push is real work (service workers, iOS quirks). First candidate for v1.1 — it directly serves the core pain. |
| AI meal suggestions | The idea pool *is* the idea generator. Easy bolt-on later if the pool runs dry. |
| Structured recipes / ingredient generation of grocery lists | Quantity math is a tarpit. Meals are names, not recipes. |
| Lunch / breakfast slots | Slot type is an enum in the model, so lunch is a config flip later, not a rebuild. v1 UI is dinner-only. |
| Plan-vs-actual history, adherence stats, meal ratings | Slot edits overwrite; only the unplanned-takeout flag survives as "what actually happened" data. |
| Apple SSO | Requires $99/yr Apple Developer membership. Google-only until a real user needs it. |
| Native apps / PWA install polish | Responsive web, phone-first. |

## Platform

- **Stack:** Remix v3 (same as the TV racker app), SQLite.
- **Hosting:** self-hosted on our Coolify instance, public HTTPS (needed for Google OAuth redirects and out-of-house family access).
- **Auth:** Google SSO only. First user creates the household; adults generate role-typed invite links (adult/kid); new sign-ups via a link join as that role.

## Decision log

| Decision | Choice | Rejected alternatives |
|---|---|---|
| Center of gravity | Weekly dinner-plan calendar | Cooking rotation, inventory-first, all-in-one |
| Family input | Shared idea pool, no friction | Propose+vote, full co-editing, post-hoc ratings |
| Planning rhythm | Weekly plan-ahead ritual | Rolling 2–3 days, day-of recommendation engine |
| Meal scope | Dinner slots only; snacks as weekly list | Lunch/all-meals slots, per-day snack slots |
| Takeout | Planned in ritual + soft counter; unplanned one-tap counts | Hard limits, no tracking |
| Grocery list | Manual shared checklist | Ingredient lines per meal, structured recipe DB |
| Roles | Adults edit, kids suggest | No roles, designated planner |
| Auth | Real accounts, Google SSO, invite links | Household PIN profiles, hardcoded allowlist, Apple SSO (deferred) |
| Day-of divergence | Edit slot + one-tap takeout log; no ledger | Plan-vs-actual ledger, immutable plan |
| Stack/hosting | Remix v3 + SQLite on Coolify | Next.js + Postgres on cloud |
