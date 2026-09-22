import test from 'node:test';
import assert from 'node:assert/strict';
import {passwordHash,passwordMatches} from '../functions/api/_passwords.js';
import {makeToken,verifyToken} from '../functions/api/_helpers.js';
const secret='test-accounts-secret-only';
test('salted password hashes reject wrong passwords and a wrong server secret',async()=>{
 const hash=await passwordHash('A long test passphrase',secret);
 assert.ok(await passwordMatches('A long test passphrase',hash,secret));
 assert.equal(await passwordMatches('Wrong passphrase',hash,secret),false);
 assert.equal(await passwordMatches('A long test passphrase',hash,'wrong-secret'),false);
 assert.notEqual(hash,await passwordHash('A long test passphrase',secret));
});
test('individual sessions are revoked on disable or password reset and shared sessions are rejected in account mode',async()=>{
 const user={id:'test-staff',username:'staff',name:'Staff',role:'staff',active:1,version:1,must_change:0};
 const env={AUTH_MODE:'accounts',SESSION_SECRET:secret,DB:{prepare(){return {bind(){return this;},async first(){return {...user};}};}}};
 const token=await makeToken(env,user);
 assert.equal(await verifyToken(env,token),true);
 user.active=0;assert.equal(await verifyToken(env,token),false);
 user.active=1;user.version=2;assert.equal(await verifyToken(env,token),false);
 assert.equal(await verifyToken(env,await makeToken(env)),false);
 assert.equal(await verifyToken(env,token+'corrupt'),false);
});
