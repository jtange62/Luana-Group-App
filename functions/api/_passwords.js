import {safeEqual} from './_helpers.js';
const encoder=new TextEncoder();
export function validPassword(password){return typeof password==='string' && password.length>=14 && password.length<=200;}
// Salted PBKDF2 with a server-side pepper; the pepper is never stored in D1.
export async function passwordHash(password,secret,salt=crypto.randomUUID()){
 if(!secret)throw new Error('SESSION_SECRET is required');
 const pepperKey=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const peppered=await crypto.subtle.sign('HMAC',pepperKey,encoder.encode(password));
 const key=await crypto.subtle.importKey('raw',peppered,'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-512'},key,256);
 return 'v1:'+salt+':'+Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function passwordMatches(password,stored,secret){
 const parts=String(stored).split(':');if(parts.length!==3||parts[0]!=='v1')return false;
 return safeEqual(await passwordHash(password,secret,parts[1]),stored);
}
