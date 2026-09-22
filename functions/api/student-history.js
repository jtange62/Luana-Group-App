import {json,verifyToken,bearer} from './_helpers.js';
import {validDate} from './visits.js';
export async function onRequestGet({request,env}) {
  if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
  const p=new URL(request.url).searchParams,id=p.get('id'),date=p.get('date');
  if(!id || id.length>64 || !validDate(date))return json({error:'Choose a student and valid date.'},400);
  const student=await env.DB.prepare('SELECT id,name,program,school_year,active FROM students WHERE id=?').bind(id).first();
  if(!student)return json({error:'Student not found'},404);
  const [history,visits]=await env.DB.batch([
    env.DB.prepare(`SELECT date,status,marked_by,kind FROM (
      SELECT a.date,a.status,a.marked_by,'Regular attendance' AS kind FROM attendance a
      WHERE a.student_id=? AND a.date<=? AND a.status!='' AND NOT EXISTS
      (SELECT 1 FROM attendance_visits v WHERE v.student_id=a.student_id AND v.date=a.date)
      UNION ALL SELECT date,status,'' AS marked_by,kind FROM attendance_visits WHERE student_id=? AND date<=? AND status!=''
    ) ORDER BY date DESC LIMIT 30`).bind(id,date,id,date),
    env.DB.prepare('SELECT date,program,kind,status,notes FROM attendance_visits WHERE student_id=? AND date>=? ORDER BY date,id LIMIT 30').bind(id,date)
  ]);
  return json({student,history:history.results,visits:visits.results});
}
