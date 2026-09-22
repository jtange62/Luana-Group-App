import {json,bearer,sessionUser,makeToken} from './_helpers.js';
import {validPassword,passwordHash,passwordMatches} from './_passwords.js';
export async function onRequestGet({request,env}){
 const user=await sessionUser(env,bearer(request));
 return user?.id?json({user}):json({error:'unauthorized'},401);
}
export async function onRequestPost({request,env}){
 const user=await sessionUser(env,bearer(request));if(!user?.id)return json({error:'unauthorized'},401);
 let body;try{body=await request.json();}catch{return json({error:'Invalid request'},400);}
 if(!validPassword(body.password)||body.password===body.current_password)return json({error:'Choose a different password of 14–200 characters.'},400);
 const stored=await env.DB.prepare('SELECT password_hash FROM staff_accounts WHERE id=?').bind(user.id).first();
 if(!await passwordMatches(String(body.current_password||''),stored.password_hash,env.SESSION_SECRET))return json({error:'Current password is incorrect.'},403);
 const hash=await passwordHash(body.password,env.SESSION_SECRET);
 const result=await env.DB.prepare('UPDATE staff_accounts SET password_hash=?,must_change=0,version=version+1 WHERE id=? AND version=? AND active=1').bind(hash,user.id,user.version).run();
 if(!result.meta?.changes)return json({error:'Sign in again before changing your password.'},409);
 user.version++;user.must_change=0;return json({token:await makeToken(env,user),user});
}
