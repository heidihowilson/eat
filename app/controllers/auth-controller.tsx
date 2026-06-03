/** @jsxRuntime automatic */
/** @jsxImportSource remix/ui */
/**
 * Auth + onboarding controllers (owned by server.ts; mapped there).
 *
 * Each `form()` leaf in routes.ts expands to .index (GET) + .action (POST). We
 * export one controller per form route plus a logout action. server.ts wires them
 * with router.map(...). Mutations are CSRF-guarded (requireSameOrigin) and reply
 * with a 303 redirect that sets/clears the session cookie — no client JS needed.
 *
 * SPEC DEVIATION: email+password instead of Google SSO (see app/auth.ts header).
 */
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import * as s from "remix/data-schema";

import { routes } from "../routes.ts";
import { render } from "../render.tsx";
import {
  CurrentUserId,
  loginCookie,
  logoutCookie,
  resolveUser,
  requireSameOrigin,
} from "../auth.ts";
import { hashPassword, verifyPassword } from "../crypto.ts";
import {
  getUserByEmail,
  createUser,
  getMembershipForUser,
  createHousehold,
  addMembership,
  getInviteByToken,
  markInviteUsed,
  getHousehold,
} from "../db.ts";
import { signupForm, loginForm, householdForm } from "../validators.ts";
import {
  SignupPage,
  LoginPage,
  JoinPage,
  InviteInvalidPage,
  HouseholdNewPage,
} from "../views/auth-pages.tsx";

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Where to send a freshly-authed user: onboarding if no household, else the week. */
async function postAuthRedirect(userId: number): Promise<string> {
  const membership = await getMembershipForUser(userId);
  return membership ? routes.week.index.href() : routes.householdNew.index.href();
}

// ============ SIGNUP ============

export const signupController = createController(routes.signup, {
  actions: {
    async index({ get }) {
      // Already signed in → skip to the app.
      const uid = get(CurrentUserId);
      if (uid !== null && (await resolveUser(uid))) return redirect(await postAuthRedirect(uid), 303);
      return render(<SignupPage />);
    },
    action: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const parsed = s.parseSafe(signupForm, get(FormData));
        if (!parsed.success) return render(<SignupPage error="Please check your details." />, { status: 400 });
        const { email, name, password } = parsed.value;

        if (!validEmail(email) || !name || password.length < 8) {
          return render(
            <SignupPage error="Name, a valid email, and an 8+ character password are required." email={email} name={name} />,
            { status: 400 }
          );
        }
        if (await getUserByEmail(email)) {
          return render(<SignupPage error="That email is already registered. Try logging in." email={email} name={name} />, {
            status: 409,
          });
        }

        const user = await createUser({ email, name, password_hash: await hashPassword(password) });
        return new Response(null, {
          status: 303,
          // New plain signup has no household yet → onboarding.
          headers: { Location: routes.householdNew.index.href(), "Set-Cookie": loginCookie(user.id) },
        });
      },
    },
  },
});

// ============ LOGIN ============

export const loginController = createController(routes.login, {
  actions: {
    async index({ get }) {
      const uid = get(CurrentUserId);
      if (uid !== null && (await resolveUser(uid))) return redirect(await postAuthRedirect(uid), 303);
      return render(<LoginPage />);
    },
    action: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const parsed = s.parseSafe(loginForm, get(FormData));
        if (!parsed.success) return render(<LoginPage error="Please check your details." />, { status: 400 });
        const { email, password } = parsed.value;

        const user = await getUserByEmail(email);
        const ok = user && (await verifyPassword(password, user.password_hash));
        if (!user || !ok) {
          return render(<LoginPage error="Wrong email or password." email={email} />, { status: 401 });
        }
        return new Response(null, {
          status: 303,
          headers: { Location: await postAuthRedirect(user.id), "Set-Cookie": loginCookie(user.id) },
        });
      },
    },
  },
});

// ============ LOGOUT (POST /logout — a root-controller leaf action) ============

// Exported as a bare action (not a controller) because /logout is a direct leaf
// of the root `routes` map; router.ts puts it in the root controller's actions.
export const logout = {
  middleware: [requireSameOrigin()],
  async handler() {
    return new Response(null, {
      status: 303,
      headers: { Location: routes.login.index.href(), "Set-Cookie": logoutCookie() },
    });
  },
};

// ============ INVITE JOIN (/join/:token) ============

export const joinController = createController(routes.join, {
  actions: {
    async index({ params }) {
      const invite = await getInviteByToken(params.token);
      if (!invite) return render(<InviteInvalidPage reason="This invite link is invalid." />, { status: 404 });
      if (invite.used_at) return render(<InviteInvalidPage reason="This invite has already been used." />, { status: 410 });
      if (new Date(invite.expires_at).getTime() < Date.now())
        return render(<InviteInvalidPage reason="This invite has expired." />, { status: 410 });

      const household = await getHousehold(invite.household_id);
      if (!household) return render(<InviteInvalidPage reason="That household no longer exists." />, { status: 404 });
      return render(<JoinPage token={params.token} householdName={household.name} role={invite.role} />);
    },
    action: {
      middleware: [requireSameOrigin()],
      async handler({ params, get }) {
        const invite = await getInviteByToken(params.token);
        if (!invite || invite.used_at || new Date(invite.expires_at).getTime() < Date.now()) {
          return render(<InviteInvalidPage reason="This invite link is no longer valid." />, { status: 410 });
        }
        const household = await getHousehold(invite.household_id);
        if (!household) return render(<InviteInvalidPage reason="That household no longer exists." />, { status: 404 });

        const parsed = s.parseSafe(signupForm, get(FormData));
        const fail = (msg: string, status = 400) =>
          render(<JoinPage token={params.token} householdName={household.name} role={invite.role} error={msg} />, {
            status,
          });
        if (!parsed.success) return fail("Please check your details.");
        const { email, name, password } = parsed.value;
        if (!validEmail(email) || !name || password.length < 8)
          return fail("Name, a valid email, and an 8+ character password are required.");
        if (await getUserByEmail(email)) return fail("That email is already registered. Log in, then ask for a fresh invite.", 409);

        // Create the user, join the inviting household at the invite's role, burn the invite.
        const user = await createUser({ email, name, password_hash: await hashPassword(password) });
        await addMembership({ user_id: user.id, household_id: invite.household_id, role: invite.role });
        await markInviteUsed(invite.id);

        return new Response(null, {
          status: 303,
          headers: { Location: routes.week.index.href(), "Set-Cookie": loginCookie(user.id) },
        });
      },
    },
  },
});

// ============ ONBOARDING: CREATE HOUSEHOLD ============

export const householdNewController = createController(routes.householdNew, {
  actions: {
    async index({ get }) {
      const uid = get(CurrentUserId);
      const user = await resolveUser(uid);
      if (!user) return redirect(routes.login.index.href(), 303);
      // Already in a household → straight to the app.
      if (await getMembershipForUser(user.id)) return redirect(routes.week.index.href(), 303);
      return render(<HouseholdNewPage />);
    },
    action: {
      middleware: [requireSameOrigin()],
      async handler({ get }) {
        const uid = get(CurrentUserId);
        const user = await resolveUser(uid);
        if (!user) return redirect(routes.login.index.href(), 303);
        if (await getMembershipForUser(user.id)) return redirect(routes.week.index.href(), 303);

        const parsed = s.parseSafe(householdForm, get(FormData));
        if (!parsed.success || !parsed.value.name)
          return render(<HouseholdNewPage error="A household name is required." />, { status: 400 });

        const household = await createHousehold({
          name: parsed.value.name,
          week_start_day: parsed.value.week_start_day,
          takeout_target: parsed.value.takeout_target,
        });
        // Creator becomes the first adult member (R1.2).
        await addMembership({ user_id: user.id, household_id: household.id, role: "adult" });

        return redirect(routes.week.index.href(), 303);
      },
    },
  },
});
