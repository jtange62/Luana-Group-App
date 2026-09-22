import test from 'node:test';
import assert from 'node:assert/strict';
import {passwordHash,passwordMatches} from '../functions/api/_passwords.js';
import {makeToken,verifyToken} from '../functions/api/_helpers.js';
import {onRequest as middleware} from '../functions/api/_middleware.js';
const secret='test-accounts-secret-only';
test('daily summary service token is restricted to reading the summary in account mode',async()=>{
 const env={AUTH_MODE:'accounts',SESSION_SECRET:secret,SUMMARY_TOKEN:'summary-service-secret'};
 const call=async(path,method='GET',token=env.SUMMARY_TOKEN)=>middleware({env,data:{},request:new Request('https://example.test/api/'+path,{method,headers:{Authorization:'Bearer '+token}}),next:async()=>new Response('ok')});
 assert.equal((await call('summary')).status,200);
 assert.equal((await call('students')).status,401);
 assert.equal((await call('summary','POST')).status,401);
 assert.equal((await call('summary','GET','incorrect')).status,401);
});
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
