import assert from 'node:assert/strict';
import { getPaymentCollectionDate as day } from '../src/utils/paymentDateUtils';
assert.equal(day({id:'pay_real',date:'2026-08-15',createdAt:'2026-11-21T12:41:52Z'}),'2026-11-21');
assert.equal(day({id:'pay_real',date:'2026-08-15',createdAt:'2026-11-20T22:30:00Z'}),'2026-11-21');
assert.equal(day({id:'pay_init_legacy',date:'2026-08-15',createdAt:'2026-11-21T12:41:52Z'}),'2026-08-15');
assert.equal(day({date:'2026-08-15',createdAt:'invalid'}),'2026-08-15');
assert.equal(day({},'2026-08-14'),'2026-08-14');
console.log('PASS: actual collection day, Cairo midnight, reconstructed legacy, invalid and missing timestamp');
