/**
 * Typed app context.
 *
 * Derives `AppContext` from the context-providing middleware so every controller
 * gets typed `get(FormData)` and `get(CurrentUserId)` without a per-controller
 * type clause. Importing this module registers the RouterTypes.context augmentation.
 *
 * Only context-SETTING middleware appear in RootMiddleware, in stack order. The DB
 * is a singleton imported directly from app/db.ts (no context key), so it is not
 * listed here. Wrappers (logger/compression/static/methodOverride) set nothing.
 */
import type { AnyParams, ContextWithParams, MiddlewareContext } from "remix/router";
import type { formData } from "remix/middleware/form-data";

import type { loadAuth } from "./auth.ts";

type RootMiddleware = [ReturnType<typeof formData>, ReturnType<typeof loadAuth>];

export type AppContext<params extends AnyParams = {}> = ContextWithParams<MiddlewareContext<RootMiddleware>, params>;

declare module "remix/router" {
  interface RouterTypes {
    context: AppContext;
  }
}
