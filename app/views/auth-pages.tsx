/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Pre-household pages: signup, login, invite-join, create-household.
 * All wrap AuthShell (no nav). Forms POST + 303-redirect (no client JS needed).
 */
import type { Handle } from "remix/ui";
import { AuthShell } from "./layout.tsx";
import { routes } from "../routes.ts";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Err(handle: Handle<{ msg?: string | null }>) {
  return () =>
    handle.props.msg ? <div class="alert alert-error text-sm py-2 mb-3">{handle.props.msg}</div> : "";
}

export function SignupPage(handle: Handle<{ error?: string | null; email?: string; name?: string }>) {
  return () => (
    <AuthShell title="Sign up">
      <p class="text-sm text-base-content/60 mb-4">Create an account to start planning dinners.</p>
      <Err msg={handle.props.error} />
      <form method="POST" action={routes.signup.action.href()} class="flex flex-col gap-3">
        <input name="name" type="text" placeholder="Your name" required class="input input-bordered w-full" value={handle.props.name ?? ""} />
        <input name="email" type="email" placeholder="Email" required class="input input-bordered w-full" value={handle.props.email ?? ""} />
        <input name="password" type="password" placeholder="Password (min 8 chars)" required minlength={8} class="input input-bordered w-full" />
        <button type="submit" class="btn btn-primary w-full">Create account</button>
      </form>
      <div class="divider my-3 text-xs">already have an account?</div>
      <a href={routes.login.index.href()} class="btn btn-ghost btn-sm w-full">Log in</a>
    </AuthShell>
  );
}

export function LoginPage(handle: Handle<{ error?: string | null; email?: string }>) {
  return () => (
    <AuthShell title="Log in">
      <Err msg={handle.props.error} />
      <form method="POST" action={routes.login.action.href()} class="flex flex-col gap-3">
        <input name="email" type="email" placeholder="Email" required class="input input-bordered w-full" value={handle.props.email ?? ""} />
        <input name="password" type="password" placeholder="Password" required class="input input-bordered w-full" />
        <button type="submit" class="btn btn-primary w-full">Log in</button>
      </form>
      <div class="divider my-3 text-xs">no account yet?</div>
      <a href={routes.signup.index.href()} class="btn btn-ghost btn-sm w-full">Sign up</a>
    </AuthShell>
  );
}

/** Invite-join: a signup form that joins the inviting household at the invite's role. */
export function JoinPage(
  handle: Handle<{ token: string; householdName: string; role: string; error?: string | null; email?: string; name?: string }>
) {
  return () => (
    <AuthShell title="Join household">
      <p class="text-sm text-base-content/70 mb-1">
        You've been invited to join <strong>{handle.props.householdName}</strong>
      </p>
      <p class="text-xs text-base-content/50 mb-4">as {handle.props.role === "adult" ? "an adult" : "a kid"}.</p>
      <Err msg={handle.props.error} />
      <form method="POST" action={routes.join.action.href({ token: handle.props.token })} class="flex flex-col gap-3">
        <input name="name" type="text" placeholder="Your name" required class="input input-bordered w-full" value={handle.props.name ?? ""} />
        <input name="email" type="email" placeholder="Email" required class="input input-bordered w-full" value={handle.props.email ?? ""} />
        <input name="password" type="password" placeholder="Password (min 8 chars)" required minlength={8} class="input input-bordered w-full" />
        <button type="submit" class="btn btn-primary w-full">Join {handle.props.householdName}</button>
      </form>
    </AuthShell>
  );
}

/** Invite-expired / invalid landing. */
export function InviteInvalidPage(handle: Handle<{ reason: string }>) {
  return () => (
    <AuthShell title="Invite">
      <div class="alert alert-warning text-sm py-2 mb-4">{handle.props.reason}</div>
      <a href={routes.login.index.href()} class="btn btn-ghost btn-sm w-full">Go to login</a>
    </AuthShell>
  );
}

/** First-run onboarding: create a household. Creator becomes the adult member. */
export function HouseholdNewPage(handle: Handle<{ error?: string | null; name?: string }>) {
  return () => (
    <AuthShell title="Create household">
      <p class="text-sm text-base-content/60 mb-4">Set up your household. You'll be the first adult.</p>
      <Err msg={handle.props.error} />
      <form method="POST" action={routes.householdNew.action.href()} class="flex flex-col gap-3">
        <label class="form-control w-full">
          <span class="label-text text-xs mb-1">Household name</span>
          <input name="name" type="text" placeholder="e.g. The Gholsons" required class="input input-bordered w-full" value={handle.props.name ?? ""} />
        </label>
        <label class="form-control w-full">
          <span class="label-text text-xs mb-1">Week starts on</span>
          <select name="week_start_day" class="select select-bordered w-full">
            {DAYS.map((d, i) => (
              <option value={String(i)} selected={i === 0}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label class="form-control w-full">
          <span class="label-text text-xs mb-1">Takeout nights / week target</span>
          <input name="takeout_target" type="number" min={0} max={7} value="2" class="input input-bordered w-full" />
        </label>
        <button type="submit" class="btn btn-primary w-full mt-1">Create household</button>
      </form>
    </AuthShell>
  );
}
