// Auth middleware for server functions (replaces requireSupabaseAuth).
// Provides { userId, db } in context. Authorization (ownership/participation
// checks) is each function's job — D1 has no RLS.

import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getDb } from "./bindings";
import { getUserIdForToken, readSessionCookie } from "./auth";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  if (!request) throw new Error("Unauthorized: no request");

  const token = readSessionCookie(request);
  const userId = await getUserIdForToken(token);
  if (!userId) throw new Error("Unauthorized: invalid or expired session");

  return next({ context: { userId, db: getDb() } });
});

// Same shape but tolerant: userId is null when logged out (for public surfaces
// like the landing claim-check that behave differently when authenticated).
export const optionalAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const token = request ? readSessionCookie(request) : "";
  const userId = token ? await getUserIdForToken(token) : null;
  return next({ context: { userId, db: getDb() } });
});
