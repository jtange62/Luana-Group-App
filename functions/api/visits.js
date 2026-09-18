import { json, verifyToken, bearer, clean } from './_helpers.js';
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
const PROGRAMS=['Preschool','Kinder','After School','Summer School'];
export async function onRequestPost({request,env}) {
 if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
 let body;try{body=await request.json();}catch{return json({error:'bad request'},400);}
 const date=clean(body.date,10),program=clean(body.program,40),kind=clean(body.kind,10),studentId=clean(body.student_id,64);
 if(!validDate(date)||!PROGRAMS.includes(program)||!['makeup','trial','other'].includes(kind))return json({error:'Choose a date, class and visit type.'},400);
 let name=clean(body.name,80);
 if(studentId){const student=await env.DB.prepare('SELECT name FROM students WHERE id=? AND active=1').bind(studentId).first();if(!student)return json({error:'Student not found'},404);name=student.name;}
 if(!name || (kind==='makeup'&&!studentId))return json({error:'Choose the student, or enter a trial visitor’s name.'},400);
 const id=crypto.randomUUID();
 const result=await env.DB.prepare('INSERT OR IGNORE INTO attendance_visits(id,student_id,name,program,date,kind,notes,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,studentId||null,name,program,date,kind,clean(body.notes,1000),Date.now()).run();
 if(!result.meta?.changes)return json({error:'This student already has a visit booked that day. Cancel the existing booking before changing it.'},409);
 return json({ok:true,id});
}
export async function onRequestPatch({request,env}) {
 if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
 let body;try{body=await request.json();}catch{return json({error:'bad request'},400);}
 if(!body.id||!['','present','absent','late'].includes(body.status))return json({error:'Invalid attendance mark'},400);
 const result=await env.DB.prepare('UPDATE attendance_visits SET status=? WHERE id=?').bind(body.status,clean(body.id,64)).run();
 return result.meta?.changes ? json({ok:true}):json({error:'Visit not found'},404);
}
export async function onRequestDelete({request,env}) {
 if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
 let body;try{body=await request.json();}catch{return json({error:'bad request'},400);}
 const id=clean(body.id,64);if(!id)return json({error:'Visit required'},400);
 await env.DB.batch([
  env.DB.prepare("DELETE FROM attendance WHERE status IN ('makeup','trial','other') AND EXISTS (SELECT 1 FROM attendance_visits v WHERE v.id=? AND v.student_id=attendance.student_id AND v.date=attendance.date)").bind(id),
  env.DB.prepare("DELETE FROM trials WHERE ('legacy-trial-' || id)=?").bind(id),
  env.DB.prepare('DELETE FROM attendance_visits WHERE id=?').bind(id)
 ]);
 return json({ok:true});
}
