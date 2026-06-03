# eat — v1 Requirements

Functional requirements, data model, and constraints for v1. See [PRODUCT.md](PRODUCT.md)
for the why behind each decision.

## 1. Functional requirements

### 1.1 Auth & household

- **R1.1** Sign in with Google (only provider in v1). No password auth.
- **R1.2** A signed-in user with no household sees a "create household" flow
  (name, week start day, takeout target). Creator becomes an adult member.
- **R1.3** Adults can generate invite links. Each link carries a role (adult | kid)
  and expires (default 7 days). Signing in via a link joins that household with that role.
- **R1.4** A user belongs to exactly one household in v1; the schema (membership table)
  permits more later.
- **R1.5** Kids can: view everything, add/edit their own idea-pool entries.
  Kids cannot: edit the plan, edit the grocery/snack lists, manage settings or invites.
  Enforced server-side, not just hidden in the UI.

### 1.2 Weekly plan

- **R2.1** The main view is the current week: one dinner slot per day,
  week anchored to the household's start day (default Sunday). Navigate to past/future weeks.
- **R2.2** Adults fill a slot with freeform text **or** by picking an idea-pool entry,
  and set its kind: `home` (default) | `takeout` | `leftovers` | `out`.
- **R2.3** Slots are freely editable; edits overwrite (no plan history).
- **R2.4** One-tap **"we got takeout"** on today's slot: sets kind to `takeout`,
  flags it unplanned, preserves nothing else. Available to adults.
- **R2.5** The week view shows the takeout counter: `used / target`, with planned vs
  unplanned distinguished. Purely informational — never blocks, at most a gentle nudge when over.

### 1.3 Idea pool

- **R3.1** Any member adds ideas: name (required), note, recipe URL, tags (all optional).
- **R3.2** Pool is searchable/filterable by text and tag.
- **R3.3** Each entry shows when it was last planned (most recent slot date referencing it).
- **R3.4** Members can edit/delete their own entries; adults can edit/delete any.
- **R3.5** Deleting an idea must not break past slots (slots keep a denormalized name or null the link).

### 1.4 Grocery & snack lists

- **R4.1** One shared grocery checklist per household: add item (text), check off,
  delete, clear checked. Adults only. **No generation from meals.**
- **R4.2** One snack list per week ("have on hand"). Adults edit;
  one-tap copies a snack item onto the grocery list.
- **R4.3** Checked grocery items persist until cleared (so the shopper can review).

### 1.5 Settings

- **R5.1** Household settings (adults only): name, week start day, weekly takeout target.
- **R5.2** Member list with roles; adults can remove members and change roles.

## 2. Data model (SQLite)

```
users        id, google_id (unique), email, name, avatar_url, created_at
households   id, name, week_start_day (0-6, default 0=Sun), takeout_target (int), created_at
memberships  id, user_id, household_id, role ('adult'|'kid'), created_at
             unique(user_id, household_id)
invites      id, household_id, token (unique), role, created_by, expires_at, used_at
ideas        id, household_id, name, note, recipe_url, tags (json), created_by,
             created_at, updated_at, deleted_at (soft delete — see R3.5)
slots        id, household_id, date, slot_type ('dinner' — enum, extensible),
             idea_id (nullable FK), text (nullable), kind ('home'|'takeout'|'leftovers'|'out'),
             takeout_unplanned (bool, default false), updated_by, updated_at
             unique(household_id, date, slot_type)
grocery_items id, household_id, text, checked_at (nullable), created_by, created_at
snack_items  id, household_id, week_start_date, text, created_by, created_at
```

Notes:
- Every domain table carries `household_id` — this is the tenancy seam.
- A slot must have `idea_id` or `text` (or both: linked idea with a text override is disallowed
  in v1 — exactly one of the two).
- "Last planned" (R3.3) = `max(slots.date) where idea_id = ?`.
- Weeks are derived from dates + `week_start_day`; no week entity.

## 3. Non-functional

- **N1** Stack: Remix v3, SQLite (file on a Coolify persistent volume), self-hosted on Coolify
  behind HTTPS with a public domain (required for Google OAuth and away-from-home access).
- **N2** Phone-first responsive web. The week view and "we got takeout" tap must work
  one-handed on a phone. No native app, no offline support.
- **N3** Household scale: ≤10 members, single household. No performance work needed;
  don't preclude multi-household (see tenancy seam).
- **N4** Backups: nightly copy of the SQLite file (Coolify volume backup or cron). It's the
  family's plan — losing a week is annoying, losing the idea pool is a real loss.
- **N5** No analytics, no third-party trackers. Family data stays on our box.

## 4. v1 acceptance walkthrough

1. Seth signs in with Google, creates household "eat", sets week start Sunday, takeout target 2.
2. Generates an adult invite and a kid invite; spouse joins as adult, kid joins as kid.
3. Kid adds "dumplings" to the idea pool from their phone.
4. Sunday: Seth fills Mon–Sun dinner slots — three from the pool (dumplings included),
   two freeform, Friday marked takeout, Sunday marked leftovers. Adds snack list, builds grocery list.
5. Wednesday 5:10pm: chaos. Spouse one-taps "we got takeout" — counter shows 2/2
   (1 planned, 1 unplanned). Nobody is scolded.
6. Next Sunday: planner sees "dumplings — last planned 6 days ago" and picks something else.

## 5. Deferred (ordered candidates for v1.1+)

1. Push notifications: daily "tonight's dinner" + weekly planning reminder.
2. Lunch slots (enum flip + UI).
3. AI "suggest dinners" seeded from idea pool + recent slots.
4. Apple SSO.
5. Multi-household / open signup.
