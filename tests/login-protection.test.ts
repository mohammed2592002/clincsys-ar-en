import assert from 'node:assert/strict';
import { createLoginLockout, createRateLimiter, parseLockDurationsEnv } from '../api/loginProtection';

// Deterministic clock: tests move it forward by hand.
let now = 1_000_000;
const advance = (ms: number) => { now += ms; };
const clock = () => now;

// Owner policy: 3 fails -> 15s, next 3 -> 30s, next 3 -> 60s, capped at 60s, success resets.
const lockout = createLoginLockout([15_000, 30_000, 60_000], clock);
const KEY = 'clinic:manager:a@b.com';

// --- Round 1: three failures trigger the 15s lock on the 3rd ---
let r = lockout.recordFailure(KEY);
assert.deepEqual({ locked: r.locked, justLocked: r.justLocked }, { locked: false, justLocked: false });
r = lockout.recordFailure(KEY);
assert.equal(r.justLocked, false);
r = lockout.recordFailure(KEY);
assert.equal(r.justLocked, true, '3rd failure must trigger the lock');
assert.equal(r.retryAfterSeconds, 15, 'first lock is 15 seconds');

// While locked, check() reports locked with a countdown, and failures do not extend the lock
assert.equal(lockout.check(KEY).locked, true);
advance(5_000);
assert.equal(lockout.check(KEY).retryAfterSeconds, 10, 'countdown ticks down');
r = lockout.recordFailure(KEY);
assert.equal(r.justLocked, false, 'failures during an active lock do not escalate');
assert.equal(r.retryAfterSeconds, 10, 'lock is not extended by attempts during the lock');

// --- Round 2: after the 15s lock expires, 3 more failures lock for 30s ---
advance(10_001); // lock fully expired
assert.equal(lockout.check(KEY).locked, false);
lockout.recordFailure(KEY);
lockout.recordFailure(KEY);
r = lockout.recordFailure(KEY);
assert.equal(r.justLocked, true);
assert.equal(r.retryAfterSeconds, 30, 'second lock is 30 seconds');

// --- Round 3: next 3 failures lock for 60s ---
advance(30_001);
lockout.recordFailure(KEY);
lockout.recordFailure(KEY);
r = lockout.recordFailure(KEY);
assert.equal(r.retryAfterSeconds, 60, 'third lock is 60 seconds');

// --- Round 4: capped at 60s forever ---
advance(60_001);
lockout.recordFailure(KEY);
lockout.recordFailure(KEY);
r = lockout.recordFailure(KEY);
assert.equal(r.retryAfterSeconds, 60, 'lock stays capped at 60 seconds');
advance(60_001);
lockout.recordFailure(KEY);
lockout.recordFailure(KEY);
r = lockout.recordFailure(KEY);
assert.equal(r.retryAfterSeconds, 60, 'still capped at 60 seconds on later rounds');

// --- Success fully resets the counter and the escalation ---
advance(60_001);
lockout.recordSuccess(KEY);
assert.equal(lockout.check(KEY).locked, false);
lockout.recordFailure(KEY);
lockout.recordFailure(KEY);
r = lockout.recordFailure(KEY);
assert.equal(r.retryAfterSeconds, 15, 'after a successful login the schedule restarts at 15 seconds');

// --- A fresh key is unaffected by another account's lockout ---
assert.equal(lockout.check('clinic:manager:other@b.com').locked, false);

// --- Default policy is exactly the owner's spec ---
const prod = createLoginLockout(parseLockDurationsEnv(undefined), clock);
prod.recordFailure('x'); prod.recordFailure('x');
const rp = prod.recordFailure('x');
assert.equal(rp.retryAfterSeconds, 15, 'default first lock is 15s');
const durations = parseLockDurationsEnv('15000, 30000, 60000');
assert.deepEqual(durations, [15_000, 30_000, 60_000]);
assert.deepEqual(parseLockDurationsEnv('garbage,, -5'), [15_000, 30_000, 60_000], 'invalid env falls back to the default policy');

// --- Rate limiter: allows up to max, blocks max+1, resets after the window ---
now = 1_000_000;
const limiter = createRateLimiter({ windowMs: 60_000, max: 3 }, clock);
assert.equal(limiter.isLimited('1.1.1.1'), false);
assert.equal(limiter.isLimited('1.1.1.1'), false);
assert.equal(limiter.isLimited('1.1.1.1'), false);
assert.equal(limiter.isLimited('1.1.1.1'), true, '4th request within the window is limited');
assert.equal(limiter.isLimited('2.2.2.2'), false, 'other IPs are unaffected');
advance(60_001);
assert.equal(limiter.isLimited('1.1.1.1'), false, 'window resets');

console.log('PASS login lockout: 3-fail rounds lock 15s -> 30s -> 60s -> capped 60s, countdown ticks, no escalation during lock, success resets to 15s, keys isolated, env parsing, IP rate limiter windows');
