import {json,bearer,sessionUser,clean} from './_helpers.js';
import {validPassword,passwordHash} from './_passwords.js';
async function admin(request,env){const u=await sessionUser(env,bearer(request));return u?.role==='admin'&&!u.must_change?u:null;}
export async function onRequestGet({request,env}){
 if(!await admin(request,env))return json({error:'Administrator access required'},403);
 const staff=await env.DB.prepare('SELECT id,username,name,role,active,must_change FROM staff_accounts ORDER BY username').all();
 const audit=await env.DB.prepare('SELECT username,action,path,created_at FROM staff_audit ORDER BY created_at DESC LIMIT 100').all();
 return json({staff:staff.results,audit:audit.results});
}
export async function onRequestPost({request,env}){
 if(!await admin(request,env))return json({error:'Administrator access required'},403);
 let b;try{b=await request.json();}catch{return json({error:'Invalid request'},400);}
 const username=clean(b.username,60).toLowerCase(),name=clean(b.name,60);
 if(!/^[a-z0-9._-]{3,60}$/.test(username)||!name||!validPassword(b.password))return json({error:'Use a username of 3–60 letters/numbers, a display name, and a temporary password of at least 14 characters.'},400);
 const hash=await passwordHash(b.password,env.SESSION_SECRET);
 const result=await env.DB.prepare("INSERT OR IGNORE INTO staff_accounts(id,username,name,role,password_hash,created_at) VALUES (?,?,?,'staff',?,?)").bind(crypto.randomUUID(),username,name,hash,Date.now()).run();
 return result.meta?.changes?json({ok:true}):json({error:'Username already exists'},409);
}
export async function onRequestPatch({request,env}){
 const actor=await admin(request,env);if(!actor)return json({error:'Administrator access required'},403);
 let b;try{b=await request.json();}catch{return json({error:'Invalid request'},400);}
 if(!b.id||b.id===actor.id)return json({error:'Use Change password for your own account. You cannot disable yourself.'},400);
 const target=await env.DB.prepare('SELECT id,role FROM staff_accounts WHERE id=?').bind(b.id).first();
 if(!target)return json({error:'Staff account not found'},404);
 if(target.role==='admin')return json({error:'Administrator recovery requires the account owner.'},403);
 if(b.action==='reset'){
   if(!validPassword(b.password))return json({error:'Temporary password must have at least 14 characters.'},400);
   await env.DB.prepare('UPDATE staff_accounts SET password_hash=?,version=version+1,must_change=1 WHERE id=?').bind(await passwordHash(b.password,env.SESSION_SECRET),b.id).run();
 }else if(b.action==='disable'||b.action==='enable'){
   await env.DB.prepare('UPDATE staff_accounts SET active=?,version=version+1 WHERE id=?').bind(b.action==='enable'?1:0,b.id).run();
 }else return json({error:'Unknown action'},400);
 return json({ok:true});
}
