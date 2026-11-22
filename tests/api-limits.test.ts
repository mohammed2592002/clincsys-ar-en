import assert from 'node:assert/strict';
import {createRateLimiter,getClientIp,apiUserKey,isApiWrite} from '../api/loginProtection';
assert.equal(getClientIp({headers:{'x-forwarded-for':'attacker'},socket:{remoteAddress:'proxy'}}),'proxy');
assert.equal(getClientIp({ip:'verified-client',headers:{'x-forwarded-for':'attacker'},socket:{remoteAddress:'proxy'}}),'verified-client');
assert.notEqual(apiUserKey({type:'staff',clinicId:'a',staffId:'1'}),apiUserKey({type:'staff',clinicId:'a',staffId:'2'}));
assert.notEqual(apiUserKey({type:'manager',clinicId:'a'}),apiUserKey({type:'manager',clinicId:'b'}));
assert.equal(apiUserKey(null),null);
for(const action of ['getDocs','getDoc','getCount','getAppointmentsCounts'])assert(!isApiWrite({method:'POST',path:'/api/db',body:{action}}));
for(const action of ['read','calendar_summary','inspect_pending'])assert(!isApiWrite({method:'POST',path:'/api/finance',body:{action}}));
for(const action of ['collect','write','delete','refund'])assert(isApiWrite({method:'POST',path:'/api/finance',body:{action}}));
for(const max of [400,120,2500]){let now=0;const l=createRateLimiter({max,windowMs:60000},()=>now);for(let i=0;i<max;i++)assert(!l.check('a').limited);assert(l.check('a').limited);assert(!l.check('b').limited);now=61000;assert(!l.check('a').limited);}
console.log('PASS 400/user, 120/write, 2500/IP boundaries; reset and identities; POST reads not writes; untrusted XFF ignored');
