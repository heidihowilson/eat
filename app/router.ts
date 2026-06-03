/**
 * Router assembly — the global middleware stack, the auth/onboarding controllers,
 * /health, and delegation to each feature module's registerRoutes().
 *
 * Middleware order (fast-exits first, body-parsers before consumers, context-
 * loaders last): logger (dev) → compression → staticFiles → formData →
 * methodOverride → asyncContext → loadAuth.
 *
 * FEATURE MODULES: week/ideas/grocery/settings own their own URLs. Each exports
 * registerRoutes(router) and is invoked once here. Feature agents edit only their
 * module — never this file.
 */
import { createController, createRouter } from "remix/router";
import { redirect } from "remix/response/redirect";
import { logger } from "remix/middleware/logger";
import { compression } from "remix/middleware/compression";
import { staticFiles } from "remix/middleware/static";
import { formData } from "remix/middleware/form-data";
import { methodOverride } from "remix/middleware/method-override";
import { asyncContext } from "remix/middleware/async-context";

import "./context.ts"; // registers the RouterTypes.context augmentation
import type { AppContext } from "./context.ts";
import { STATIC_ROOT } from "./config.ts";
import { loadAuth } from "./auth.ts";
import { routes } from "./routes.ts";

import {
  signupController,
  loginController,
  logout,
  joinController,
  householdNewController,
} from "./controllers/auth-controller.tsx";

import { registerRoutes as registerWeek } from "./routes/week.tsx";
import { registerRoutes as registerIdeas } from "./routes/ideas.tsx";
import { registerRoutes as registerGrocery } from "./routes/grocery.tsx";
import { registerRoutes as registerSettings } from "./routes/settings.tsx";

const middleware = [];
if (process.env.NODE_ENV === "development") middleware.push(logger());
middleware.push(compression());
middleware.push(staticFiles(STATIC_ROOT, { cacheControl: "public, max-age=86400, immutable" }));
middleware.push(formData());
middleware.push(methodOverride());
middleware.push(asyncContext());
middleware.push(loadAuth());

export const router = createRouter<AppContext>({ middleware });

// ── Root leaves: /health (plain text, no auth) + POST /logout. ──
// Every direct LEAF key of `routes` (health, logout) needs an action here; the
// form()/route() namespaces (signup/login/join/householdNew/week/...) are nested
// maps with their own controllers, so they are NOT keys in this controller.
const rootController = createController(routes, {
  actions: {
    // Bare-domain entry → send to the week view. The /week guard chain handles the
    // rest: unauthenticated → /login, authenticated-without-household → /household/new.
    root() {
      return redirect(routes.week.index.href(), 303);
    },
    health() {
      return new Response("OK");
    },
    logout,
  },
});
router.map(routes, rootController);

// ── Auth + onboarding (form() namespaces). ──
router.map(routes.signup, signupController);
router.map(routes.login, loginController);
router.map(routes.join, joinController);
router.map(routes.householdNew, householdNewController);

// ── Feature modules: each owns its subtree. ──
registerWeek(router);
registerIdeas(router);
registerGrocery(router);
registerSettings(router);
