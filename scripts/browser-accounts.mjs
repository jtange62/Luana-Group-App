import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {passwordHash} from '../functions/api/_passwords.js';
const origin='http://127.0.0.1:8792',secret='account-browser-test-secret',initial='Initial test password 2026',changed='Changed test password 2026';
const scratch='.wrangler/account-tests';mkdirSync(scratch,{recursive:true});
const hash=await passwordHash(initial,secret);
writeFileSync(scratch+'/seed.sql',readFileSync('schema.sql','utf8')+"\nDELETE FROM staff_accounts; DELETE FROM login_attempts; DELETE FROM staff_audit; INSERT INTO staff_accounts(id,username,name,role,password_hash,created_at) VALUES ('admin','admin','Test admin','admin','"+hash+"',1);");
const seed=spawnSync('wrangler d1 execute luana-board --local --persist-to '+scratch+'/state --file '+scratch+'/seed.sql',{shell:true,windowsHide:true,stdio:'pipe'});
if(seed.status!==0)throw new Error('Account test database setup failed: '+seed.stderr);
const server=spawn('wrangler pages dev public --port 8792 --persist-to '+scratch+'/state --binding AUTH_MODE=accounts --binding SESSION_SECRET='+secret,{shell:true,windowsHide:true,stdio:'pipe',detached:process.platform!=='win32'});
server.stdout.on('data',()=>{});server.stderr.on('data',()=>{});
let browser;
async function api(path,method='GET',body,token){return fetch(origin+'/api/'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});}
try{
 for(let i=0;i<60;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 const chrome=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
 browser=await chromium.launch({executablePath:chrome,headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(origin);
 await page.locator('#username').fill('admin');await page.locator('#pwInput').fill(initial);await page.locator('#enterBtn').click();
 await page.waitForURL('**/tools/account/');
 const oldToken=await page.evaluate(()=>localStorage.getItem('luana_token'));
 assert.equal((await api('students', 'GET',null,oldToken)).status,403);
 await page.locator('#currentPassword').fill(initial);await page.locator('#newPassword').fill(changed);await page.locator('#confirmPassword').fill(changed);
 await page.locator('#passwordForm button').click();await page.locator('#admin').waitFor();
 const token=await page.evaluate(()=>localStorage.getItem('luana_token'));
 assert.equal((await api('account','GET',null,oldToken)).status,401);
 await page.locator('#staffUsername').fill('teacher');await page.locator('#staffName').fill('Teacher');
 await page.locator('#staffPassword').fill(initial);await page.locator('#addStaff button').click();
 await page.locator('#staffList article').filter({hasText:'Teacher (teacher)'}).waitFor();
 const login=await (await api('login','POST',{username:'teacher',password:initial})).json();
 const updated=await (await api('account','POST',{current_password:initial,password:changed},login.token)).json();
 assert.ok(updated.token);assert.equal((await api('staff','GET',null,updated.token)).status,403);
 const event=await api('event','POST',{title:'Verified actor test',calendar:'general',author:'Impersonated admin',start_date:'2026-09-22'},updated.token);
 assert.equal(event.status,200);const eventId=(await event.json()).id;
 const events=await (await api('events?from=2026-09-22&to=2026-09-22','GET',null,token)).json();
 assert.equal(events.events.find(e=>e.id===eventId).author,'Teacher');
 const staff=await (await api('staff','GET',null,token)).json();const teacher=staff.staff.find(u=>u.username==='teacher');
 assert.ok(staff.audit.some(a=>a.username==='teacher'&&a.path==='/api/event'));
 assert.equal((await api('staff','PATCH',{id:teacher.id,action:'disable'},token)).status,200);
 assert.equal((await api('events','GET',null,updated.token)).status,401);
 assert.equal((await api('login','POST',{username:'teacher',password:changed})).status,401);
 assert.equal((await api('staff','PATCH',{id:teacher.id,action:'enable'},token)).status,200);
 const tokenBeforeReset=(await (await api('login','POST',{username:'teacher',password:changed})).json()).token;
 assert.equal((await api('staff','PATCH',{id:teacher.id,action:'reset',password:initial},token)).status,200);
 assert.equal((await api('events','GET',null,tokenBeforeReset)).status,401);
 await page.goto(origin+'/tools/account/');await page.locator('#admin').waitFor();
 await page.screenshot({path:scratch+'/account-phone.png',fullPage:true});
 // The disabled-account login above already consumed one failed attempt.
 for(let i=0;i<4;i++)assert.equal((await api('login','POST',{username:'admin',password:'wrong'})).status,401);
 assert.equal((await api('login','POST',{username:'admin',password:changed})).status,429);
 console.log('Account browser checks passed: forced password change, staff creation, verified authors, audit, roles, disable, reset, rate limits.');
}finally{
 await browser?.close();
 if(process.platform==='win32')spawnSync('taskkill',['/pid',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 else process.kill(-server.pid,'SIGTERM');
}
