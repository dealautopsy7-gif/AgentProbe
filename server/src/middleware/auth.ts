import type { NextFunction, Request, Response } from "express";
import { getSupabase } from "../lib/supabase.js";

/**
 * Verifies the Supabase session JWT from `Authorization: Bearer <token>`
 * and attaches the real user id to the request. Every protected route reads
 * req.userId, never a client-supplied one — closes the "never trust the
 * client" gap the routes previously had (userId was a request-body field).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization: Bearer <token> header" });
  }

  const { data, error } = await getSupabase().auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  req.userId = data.user.id;
  next();
}
