/**
 * Boundary validation schemas for auth + onboarding (shared).
 *
 * Form bodies use f.object / f.field; parse with s.parseSafe(...) so failure is a
 * value, not a throw. Feature modules define their own schemas locally; these are
 * the ones server.ts needs.
 */
import * as s from "remix/data-schema";
import * as f from "remix/data-schema/form-data";
import * as coerce from "remix/data-schema/coerce";

const trimmed = () => s.defaulted(s.string(), "").transform((v) => v.trim());

/** POST /signup (also /join/:token signup) */
export const signupForm = f.object({
  email: f.field(trimmed()),
  name: f.field(trimmed()),
  password: f.field(s.defaulted(s.string(), "")),
});

/** POST /login */
export const loginForm = f.object({
  email: f.field(trimmed()),
  password: f.field(s.defaulted(s.string(), "")),
});

/** POST /household/new */
export const householdForm = f.object({
  name: f.field(trimmed()),
  week_start_day: f.field(s.defaulted(coerce.number(), 0).transform((n) => (n >= 0 && n <= 6 ? Math.trunc(n) : 0))),
  takeout_target: f.field(s.defaulted(coerce.number(), 0).transform((n) => (n >= 0 && n <= 7 ? Math.trunc(n) : 0))),
});

export const ROLE_VALUES = ["adult", "kid"] as const;
export const roleSchema = s.enum_(ROLE_VALUES);
