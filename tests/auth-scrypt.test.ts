import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, isPasswordHashed } from '../api/index';

// Async scrypt round-trip
const hash1 = await hashPassword('MySecret123');
assert.equal(isPasswordHashed(hash1), true, 'hash carries the scrypt$ prefix');
assert.match(hash1, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
assert.equal(await verifyPassword(hash1, 'MySecret123'), true, 'correct password verifies');
assert.equal(await verifyPassword(hash1, 'WrongPass'), false, 'wrong password rejected');
assert.equal(await verifyPassword(hash1, ''), false, 'empty password rejected');
assert.equal(await verifyPassword(hash1, 'MySecret1234'), false);

// Hashing is salted: same password gives different hashes, both verify
const hash2 = await hashPassword('MySecret123');
assert.notEqual(hash1, hash2, 'salts differ between hashes');
assert.equal(await verifyPassword(hash2, 'MySecret123'), true);

// Legacy plaintext rows still verify (constant-time path) until migrated
assert.equal(await verifyPassword('plainpass', 'plainpass'), true, 'legacy plaintext still works');
assert.equal(await verifyPassword('plainpass', 'nope'), false);
assert.equal(await verifyPassword(undefined, 'x'), false);
assert.equal(await verifyPassword('scrypt$broken', 'x'), false);

// Async contract: verifyPassword returns a Promise, not a boolean (non-blocking hashing)
const p = verifyPassword(hash1, 'MySecret123');
assert.equal(typeof (p as any).then, 'function', 'verifyPassword is async (threadpool, non-blocking)');
assert.equal(await p, true);

// Unicode / Arabic passwords work
const arHash = await hashPassword('كلمة سر قوية 123');
assert.equal(await verifyPassword(arHash, 'كلمة سر قوية 123'), true);
assert.equal(await verifyPassword(arHash, 'كلمة سر قوية 124'), false);

console.log('PASS async scrypt: round-trip, salted, wrong/empty/legacy/unicode cases, Promise-based (non-blocking) API');
