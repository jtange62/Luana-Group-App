import {json,safeEqual} from './_helpers.js';
import {passwordHash,validPassword} from './_passwords.js';
export async function onRequestPost({request,env}){
 let b;try{b=await request.json();}catch{return json({error:'Invalid request'},400);}
 if(!env.STAFF_SETUP_TOKEN||!await safeEqual(b.setup_token||'',env.STAFF_SETUP_TOKEN))return json({error:'Not found'},404);
 if(b.username!=='jtange'||!validPassword(b.password))return json({error:'Invalid administrator details'},400);
 const result=await env.DB.prepare("INSERT INTO staff_accounts(id,username,name,role,password_hash,created_at) SELECT ?,?,?,'admin',?,? WHERE NOT EXISTS (SELECT 1 FROM staff_accounts WHERE role='admin')")
   .bind(crypto.randomUUID(),'jtange','jtange',await passwordHash(b.password,env.SESSION_SECRET),Date.now()).run();
 return result.meta?.changes?json({ok:true}):json({error:'Administrator already exists'},409);
}
