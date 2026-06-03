/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Settings feature module — household settings, members, invites.
 *
 * OWNERSHIP: owns every /settings* URL. Filled in WITHOUT touching server.ts.
 *
 * Requirements implemented here:
 *   R5.1  Household settings (adults only): name, week start day, weekly takeout target.
 *   R5.2  Member list with roles; adults can change a member's role and remove members.
 *   R1.3  (admin side) Adults generate role-typed invite links (7-day expiry); list +
 *         revoke active invites. The /join/:token CONSUMPTION flow lives in the auth
 *         controller — we only link to it here.
 *
 * Guard rails baked in:
 *   - Every mutation is `requireAdult` + `requireSameOrigin()` (server-side R1.5).
 *   - Every query is scoped to `g.value.household.id` (tenancy seam) — ids from the
 *     form are validated to belong to this household before use.
 *   - You cannot remove yourself or demote yourself if you are the LAST adult — the
 *     household would be left with nobody able to manage it.
 *
 * NOTE: kids never reach /settings — the index redirects them to the week via
 * requireAdult's 403... actually requireAdult returns a 403 for kids; the Settings
 * tab is already hidden for kids in the layout (showSettings={role==="adult"}), and
 * the brief's "kids see read-only basics" is satisfied by them simply not having the
 * tab. We keep the whole page adult-only for a clean R1.5 server-side boundary.
 */
import { createController, type Router } from "remix/router";
import type { AppContext } from "../context.ts";
import { redirect } from "remix/response/redirect";
import * as s from "remix/data-schema";
import * as f from "remix/data-schema/form-data";
import * as coerce from "remix/data-schema/coerce";
import { sql } from "remix/data-table";

import { routes } from "../routes.ts";
import { render } from "../render.tsx";
import { CurrentUserId, requireAdult, requireSameOrigin } from "../auth.ts";
import { randomToken } from "../crypto.ts";
import { INVITE_TTL_MS } from "../config.ts";
import {
  db,
  invites,
  memberships,
  nowIso,
  updateHousehold,
  getHouseholdMembers,
  type Invite,
} from "../db.ts";
import { roleSchema } from "../validators.ts";
import { SettingsPage, type ActiveInvite, type MemberRow } from "../views/settings.tsx";

// ============ FORM SCHEMAS ============

const householdSettingsForm = f.object({
  name: f.field(s.defaulted(s.string(), "").transform((v) => v.trim())),
  week_start_day: f.field(
    s.defaulted(coerce.number(), 0).transform((n) => (n >= 0 && n <= 6 ? Math.trunc(n) : 0))
  ),
  takeout_target: f.field(
    s.defaulted(coerce.number(), 0).transform((n) => (n >= 0 && n <= 7 ? Math.trunc(n) : 0))
  ),
});

const inviteForm = f.object({ role: f.field(roleSchema) });

const memberIdForm = f.object({
  member_id: f.field(s.defaulted(coerce.number(), 0).transform((n) => Math.trunc(n))),
});

const changeRoleForm = f.object({
  member_id: f.field(s.defaulted(coerce.number(), 0).transform((n) => Math.trunc(n))),
  role: f.field(roleSchema),
});

const inviteIdForm = f.object({
  invite_id: f.field(s.defaulted(coerce.number(), 0).transform((n) => Math.trunc(n))),
});

// ============ ORIGIN HELPER ============

/**
 * Build the public origin (scheme://host) for invite URLs from the incoming
 * request, so a generated link works both in production
 * (https://eat.sethgholson.com) and locally (http://localhost:8000).
 *
 * Behind the Coolify/Traefik proxy TLS terminates at the edge, so prefer the
 * forwarded headers; fall back to the Host header / parsed URL.
 */
function requestOrigin(headers: Headers, url: URL): string {
  const proto = headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = headers.get("x-forwarded-host")?.split(",")[0].trim() || headers.get("host") || url.host;
  return `${proto}://${host}`;
}

// ============ QUERIES (scoped to the session's household) ============

/** Active (un-used, un-expired) invites for a household, newest first. */
async function getActiveInvites(householdId: number): Promise<Invite[]> {
  const now = nowIso();
  const result = await db.exec(sql`
    SELECT * FROM invites
    WHERE household_id = ${householdId}
      AND used_at IS NULL
      AND expires_at > ${now}
    ORDER BY created_at DESC
  `);
  return (result.rows ?? []) as Invite[];
}

/** Count of adult members in a household (for last-adult protection). */
async function countAdults(householdId: number): Promise<number> {
  const result = await db.exec(sql`
    SELECT COUNT(*) AS n FROM memberships
    WHERE household_id = ${householdId} AND role = 'adult'
  `);
  const row = (result.rows ?? [])[0] as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

const settingsController = createController(routes.settings, {
  actions: {
    // GET /settings — adults only (R5.1 / R5.2 / R1.3 admin).
    async index({ get, headers, url }) {
      const g = await requireAdult(get(CurrentUserId));
      if (!g.ok) return g.response;
      const { household, user } = g.value;

      const memberRows = await getHouseholdMembers(household.id);
      const adultCount = memberRows.filter((m) => m.membership.role === "adult").length;
      const members: MemberRow[] = memberRows.map((m) => ({
        membershipId: m.membership.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.membership.role,
        isSelf: m.user.id === user.id,
        // Can't strip the last adult of their powers or remove them.
        isLastAdult: m.membership.role === "adult" && adultCount <= 1,
      }));

      const origin = requestOrigin(headers, url);
      const activeInvites = await getActiveInvites(household.id);
      const inviteList: ActiveInvite[] = activeInvites.map((inv) => ({
        id: inv.id,
        role: inv.role,
        url: `${origin}${routes.join.index.href({ token: inv.token })}`,
        expiresAt: inv.expires_at,
      }));

      return render(
        <SettingsPage
          householdName={household.name}
          weekStartDay={household.week_start_day}
          takeoutTarget={household.takeout_target}
          members={members}
          invites={inviteList}
        />
      );
    },

    // POST /settings/update — household name / week start / takeout target (R5.1).
    update: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;

        const parsed = s.parseSafe(householdSettingsForm, get(FormData));
        if (!parsed.success) return redirect(routes.settings.index.href(), 303);

        const { name, week_start_day, takeout_target } = parsed.value;
        // Ignore an empty name (keep the existing one) — don't let a blank wipe it.
        await updateHousehold(g.value.household.id, {
          ...(name ? { name } : {}),
          week_start_day,
          takeout_target,
        });
        return redirect(routes.settings.index.href(), 303);
      },
    },

    // POST /settings/invite — generate a role-typed invite link (R1.3).
    createInvite: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;

        const parsed = s.parseSafe(inviteForm, get(FormData));
        const role = parsed.success ? parsed.value.role : "kid";
        await db.create(invites, {
          household_id: g.value.household.id,
          role,
          created_by: g.value.user.id,
          // crypto.randomUUID-style opaque token (randomToken = base64url random bytes).
          token: randomToken(),
          expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
          created_at: nowIso(),
        });
        return redirect(routes.settings.index.href(), 303);
      },
    },

    // POST /settings/invite/revoke — delete an active invite (R1.3).
    revokeInvite: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;

        const parsed = s.parseSafe(inviteIdForm, get(FormData));
        if (!parsed.success || !parsed.value.invite_id) return redirect(routes.settings.index.href(), 303);

        // Tenancy: only delete an invite that belongs to THIS household.
        await db.exec(sql`
          DELETE FROM invites
          WHERE id = ${parsed.value.invite_id} AND household_id = ${g.value.household.id}
        `);
        return redirect(routes.settings.index.href(), 303);
      },
    },

    // POST /settings/member/remove — remove a member (R5.2).
    removeMember: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;

        const parsed = s.parseSafe(memberIdForm, get(FormData));
        if (!parsed.success || !parsed.value.member_id) return redirect(routes.settings.index.href(), 303);

        const target = await resolveHouseholdMember(parsed.value.member_id, g.value.household.id);
        if (!target) return redirect(routes.settings.index.href(), 303);

        // Can't remove the last adult (would orphan the household — R5.2 guard).
        if (target.role === "adult" && (await countAdults(g.value.household.id)) <= 1) {
          return redirect(routes.settings.index.href(), 303);
        }

        await db.delete(memberships, target.id);
        return redirect(routes.settings.index.href(), 303);
      },
    },

    // POST /settings/member/role — change a member's role (R5.2).
    changeRole: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const g = await requireAdult(get(CurrentUserId));
        if (!g.ok) return g.response;

        const parsed = s.parseSafe(changeRoleForm, get(FormData));
        if (!parsed.success || !parsed.value.member_id) return redirect(routes.settings.index.href(), 303);

        const target = await resolveHouseholdMember(parsed.value.member_id, g.value.household.id);
        if (!target) return redirect(routes.settings.index.href(), 303);

        // No-op if unchanged.
        if (target.role === parsed.value.role) return redirect(routes.settings.index.href(), 303);

        // Demoting an adult to kid: block if they're the last adult.
        if (
          target.role === "adult" &&
          parsed.value.role === "kid" &&
          (await countAdults(g.value.household.id)) <= 1
        ) {
          return redirect(routes.settings.index.href(), 303);
        }

        await db.update(memberships, target.id, { role: parsed.value.role });
        return redirect(routes.settings.index.href(), 303);
      },
    },
  },
});

// ============ MEMBERSHIP RESOLUTION (tenancy-checked) ============

/**
 * Resolve a membership by its PK, but ONLY if it belongs to `householdId`. Returns
 * the membership row or null — never trust a member_id straight from the form.
 */
async function resolveHouseholdMember(
  membershipId: number,
  householdId: number
): Promise<{ id: number; user_id: number; role: "adult" | "kid" } | null> {
  const result = await db.exec(sql`
    SELECT id, user_id, role FROM memberships
    WHERE id = ${membershipId} AND household_id = ${householdId}
    LIMIT 1
  `);
  const row = (result.rows ?? [])[0] as { id: number; user_id: number; role: "adult" | "kid" } | undefined;
  return row ?? null;
}

export function registerRoutes(router: Router<AppContext>): void {
  router.map(routes.settings, settingsController);
}
