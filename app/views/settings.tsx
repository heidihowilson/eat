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
      <span class="badge badge-primary badge-sm">adult</span>
    ) : (
      <span class="badge badge-ghost badge-sm">kid</span>
    );
}

export function SettingsPage(handle: Handle<SettingsProps>) {
  return () => {
    const { householdName, weekStartDay, takeoutTarget, members, invites } = handle.props;

    return (
      <Layout title="Settings" active="settings" showSettings={true}>
        <div class="flex flex-col gap-6">
          {/* ── Household settings (R5.1) ── */}
          <section class="card bg-base-200">
            <div class="card-body gap-3">
              <h2 class="card-title text-base">Household</h2>
              <form method="POST" action={routes.settings.update.href()} class="flex flex-col gap-3">
                <label class="form-control w-full">
                  <span class="label-text text-xs mb-1">Household name</span>
                  <input
                    name="name"
                    type="text"
                    required
                    value={householdName}
                    class="input input-bordered w-full"
                  />
                </label>

                <label class="form-control w-full">
                  <span class="label-text text-xs mb-1">Week starts on</span>
                  <select name="week_start_day" class="select select-bordered w-full">
                    {DAYS.map((d, i) => (
                      <option value={String(i)} selected={i === weekStartDay}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>

                <label class="form-control w-full">
                  <span class="label-text text-xs mb-1">Takeout nights / week target</span>
                  <input
                    name="takeout_target"
                    type="number"
                    min={0}
                    max={7}
                    value={String(takeoutTarget)}
                    class="input input-bordered w-full"
                  />
                </label>

                <button type="submit" class="btn btn-primary w-full mt-1">
                  Save settings
                </button>
              </form>
            </div>
          </section>

          {/* ── Members (R5.2) ── */}
          <section class="card bg-base-200">
            <div class="card-body gap-3">
              <h2 class="card-title text-base">Members</h2>
              <ul class="flex flex-col divide-y divide-base-300">
                {members.map((m) => (
                  <li class="py-3 flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="font-medium truncate">{m.name}</span>
                          <RoleBadge role={m.role} />
                          {m.isSelf ? <span class="badge badge-outline badge-sm">you</span> : ""}
                        </div>
                        <div class="text-xs text-base-content/50 truncate">{m.email}</div>
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
                          class="select select-bordered select-sm"
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
                          <button type="submit" class="btn btn-ghost btn-sm">
                            Set role
                          </button>
                        )}
                      </form>

                      <div class="flex-1"></div>

                      {/* Remove member — blocked for the last adult. */}
                      {m.isLastAdult ? (
                        <span class="text-xs text-base-content/40">last adult</span>
                      ) : (
                        <form method="POST" action={routes.settings.removeMember.href()}>
                          <input type="hidden" name="member_id" value={String(m.membershipId)} />
                          <button
                            type="submit"
                            class="btn btn-ghost btn-sm text-error"
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
            </div>
          </section>

          {/* ── Invites (R1.3 admin side) ── */}
          <section class="card bg-base-200">
            <div class="card-body gap-3">
              <h2 class="card-title text-base">Invite links</h2>
              <p class="text-xs text-base-content/50">
                Share a link to add someone. Links expire after 7 days and work once.
              </p>

              <form
                method="POST"
                action={routes.settings.createInvite.href()}
                class="flex items-end gap-2"
              >
                <label class="form-control flex-1">
                  <span class="label-text text-xs mb-1">Role</span>
                  <select name="role" class="select select-bordered w-full">
                    <option value="adult">adult</option>
                    <option value="kid" selected>
                      kid
                    </option>
                  </select>
                </label>
                <button type="submit" class="btn btn-primary">
                  Create link
                </button>
              </form>

              {invites.length === 0 ? (
                <p class="text-sm text-base-content/40 py-2">No active invite links.</p>
              ) : (
                <ul class="flex flex-col gap-3">
                  {invites.map((inv) => (
                    <li class="flex flex-col gap-1 rounded-box bg-base-100 p-3">
                      <div class="flex items-center gap-2">
                        <RoleBadge role={inv.role} />
                        <span class="text-xs text-base-content/50">{expiresLabel(inv.expiresAt)}</span>
                        <div class="flex-1"></div>
                        <form method="POST" action={routes.settings.revokeInvite.href()}>
                          <input type="hidden" name="invite_id" value={String(inv.id)} />
                          <button
                            type="submit"
                            class="btn btn-ghost btn-xs text-error"
                            data-confirm="Revoke this invite link?"
                          >
                            Revoke
                          </button>
                        </form>
                      </div>
                      {/* Read-only so the adult can long-press / select-all to copy on a phone. */}
                      <input
                        type="text"
                        readonly
                        value={inv.url}
                        class="input input-bordered input-sm w-full font-mono text-xs"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </Layout>
    );
  };
}
