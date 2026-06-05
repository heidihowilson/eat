/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Settings page (adults only): household settings form, member list with role
 * controls, and the invite section (create + list + revoke).
 *
 * All mutations are plain POST forms that 303-redirect back here (no client JS
 * needed). Destructive actions carry data-confirm="..." which the shared handler
 * in public/static/app.js wires to a window.confirm() guard.
 */
import type { Handle } from "remix/ui";
import { Layout } from "./layout.tsx";
import { routes } from "../routes.ts";
import type { Role } from "../db.ts";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface MemberRow {
  membershipId: number;
  userId: number;
  name: string;
  email: string;
  role: Role;
  isSelf: boolean;
  isLastAdult: boolean;
}

export interface ActiveInvite {
  id: number;
  role: Role;
  url: string;
  expiresAt: string; // ISO
}

interface SettingsProps {
  householdName: string;
  weekStartDay: number;
  takeoutTarget: number;
  members: MemberRow[];
  invites: ActiveInvite[];
}

/** "in 6 days" / "in 3 hours" — gentle relative expiry, no library. */
function expiresLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `expires in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
}

function RoleBadge(handle: Handle<{ role: Role }>) {
  return () =>
    handle.props.role === "adult" ? (
      <span class="mk-badge mk-badge--sm mk-badge--dot mk-badge--accent">adult</span>
    ) : (
      <span class="mk-badge mk-badge--sm mk-badge--dot">kid</span>
    );
}

export function SettingsPage(handle: Handle<SettingsProps>) {
  return () => {
    const { householdName, weekStartDay, takeoutTarget, members, invites } = handle.props;

    return (
      <Layout title="Settings" active="settings" showSettings={true}>
        <div class="flex flex-col gap-6">
          {/* ── Household settings (R5.1) ── */}
          <section class="mk-card flex flex-col gap-3">
            <h2 class="text-base">Household</h2>
            <form method="POST" action={routes.settings.update.href()} class="flex flex-col gap-3">
              <div class="mk-field">
                <label for="household-name">Household name</label>
                <input
                  id="household-name"
                  name="name"
                  type="text"
                  required
                  value={householdName}
                  class="mk-input"
                />
              </div>

              <div class="mk-field">
                <label for="week-start-day">Week starts on</label>
                <select id="week-start-day" name="week_start_day" class="mk-select">
                  {DAYS.map((d, i) => (
                    <option value={String(i)} selected={i === weekStartDay}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div class="mk-field">
                <label for="takeout-target">Takeout nights / week target</label>
                <input
                  id="takeout-target"
                  name="takeout_target"
                  type="number"
                  min={0}
                  max={7}
                  value={String(takeoutTarget)}
                  class="mk-input"
                />
              </div>

              <button type="submit" class="mk-btn mk-btn--primary mk-btn--block mt-1">
                Save settings
              </button>
            </form>
          </section>

          {/* ── Members (R5.2) ── */}
          <section class="mk-card flex flex-col gap-3">
            <h2 class="text-base">Members</h2>
            <ul class="flex flex-col gap-1 list-none m-0 p-0">
              {members.map((m) => (
                <li class="py-2 flex flex-col gap-2">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-medium truncate">{m.name}</span>
                        <RoleBadge role={m.role} />
                        {m.isSelf ? <span class="mk-badge mk-badge--sm">you</span> : ""}
                      </div>
                      <div class="text-xs text-muted truncate">{m.email}</div>
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    {/* Change role — submits on select change via the shared handler. */}
                    <form
                      method="POST"
                      action={routes.settings.changeRole.href()}
                      class="flex items-center gap-2"
                    >
                      <input type="hidden" name="member_id" value={String(m.membershipId)} />
                      <select
                        name="role"
                        class="mk-select w-auto"
                        disabled={m.isLastAdult}
                      >
                        <option value="adult" selected={m.role === "adult"}>
                          adult
                        </option>
                        <option value="kid" selected={m.role === "kid"}>
                          kid
                        </option>
                      </select>
                      {m.isLastAdult ? (
                        ""
                      ) : (
                        <button type="submit" class="mk-btn mk-btn--ghost mk-btn--sm">
                          Set role
                        </button>
                      )}
                    </form>

                    <div class="flex-1"></div>

                    {/* Remove member — blocked for the last adult. */}
                    {m.isLastAdult ? (
                      <span class="text-xs text-faint">last adult</span>
                    ) : (
                      <form method="POST" action={routes.settings.removeMember.href()}>
                        <input type="hidden" name="member_id" value={String(m.membershipId)} />
                        <button
                          type="submit"
                          class="mk-btn mk-btn--ghost mk-btn--sm text-danger"
                          data-confirm={`Remove ${m.name} from ${householdName}?`}
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Invites (R1.3 admin side) ── */}
          <section class="mk-card flex flex-col gap-3">
            <h2 class="text-base">Invite links</h2>
            <p class="text-xs text-muted">
              Share a link to add someone. Links expire after 7 days and work once.
            </p>

            <form
              method="POST"
              action={routes.settings.createInvite.href()}
              class="flex items-end gap-2"
            >
              <div class="mk-field flex-1">
                <label for="invite-role">Role</label>
                <select id="invite-role" name="role" class="mk-select">
                  <option value="adult">adult</option>
                  <option value="kid" selected>
                    kid
                  </option>
                </select>
              </div>
              <button type="submit" class="mk-btn mk-btn--primary">
                Create link
              </button>
            </form>

            {invites.length === 0 ? (
              <p class="text-sm text-faint py-2">No active invite links.</p>
            ) : (
              <ul class="flex flex-col gap-3 list-none m-0 p-0">
                {invites.map((inv) => (
                  <li class="flex flex-col gap-1 mk-card mk-card--sunken p-3">
                    <div class="flex items-center gap-2">
                      <RoleBadge role={inv.role} />
                      <span class="text-xs text-muted">{expiresLabel(inv.expiresAt)}</span>
                      <div class="flex-1"></div>
                      <form method="POST" action={routes.settings.revokeInvite.href()}>
                        <input type="hidden" name="invite_id" value={String(inv.id)} />
                        <button
                          type="submit"
                          class="mk-btn mk-btn--ghost mk-btn--sm text-danger"
                          data-confirm="Revoke this invite link?"
                        >
                          Revoke
                        </button>
                      </form>
                    </div>
                    {/* Copy button (data-copy handler in app.js); input stays for manual copy fallback. */}
                    <div class="flex gap-2">
                      <input
                        type="text"
                        readonly
                        value={inv.url}
                        class="mk-input flex-1 min-w-0 font-mono text-xs"
                      />
                      <button type="button" class="mk-btn shrink-0" data-copy={inv.url}>
                        Copy
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Layout>
    );
  };
}
