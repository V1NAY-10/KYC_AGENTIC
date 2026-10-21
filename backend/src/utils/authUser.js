/**
 * Clerk user id for a request.
 * @clerk/express now exposes `req.auth()` as a function (property access is
 * deprecated); plain `{ userId }` objects are still accepted for tests.
 */
export function authUserId(req) {
  const auth = typeof req.auth === 'function' ? req.auth() : req.auth;
  return auth?.userId ?? null;
}
