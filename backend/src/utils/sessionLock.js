/**
 * Per-session mutex (in-process).
 *
 * Working memory is read-modify-write on a single Redis key, so two turns for the
 * same session running concurrently (double audio submit, reconnect replay, async
 * FraudAgent write-back) would silently overwrite each other's fields. Every
 * mutation of a session's state goes through here so they run one at a time.
 *
 * Scope: one Node process. If the backend is ever scaled horizontally, replace
 * with a Redis lock (SET key NX PX) — callers don't need to change.
 */
const queues = new Map();

export function withSessionLock(sessionId, fn) {
  const key  = String(sessionId);
  const prev = queues.get(key) || Promise.resolve();
  const run  = prev.then(fn, fn);
  const tail = run.catch(() => {});

  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });

  return run;
}
