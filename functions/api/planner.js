import { json, verifyToken, bearer } from './_helpers.js';
import {schoolYear} from './_school-year.js';
import { shapeDay } from './_today.js';
import { validDate } from './visits.js';
export async function onRequestGet({request,env}) {
 if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
 const params=new URL(request.url).searchParams,from=params.get('from'),to=params.get('to');
 if(!validDate(from)||!validDate(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>41)return json({error:'Choose a valid range of up to 42 days.'},400);
 const [students,marks,trials,events,themes,visits,summer]=await env.DB.batch([
  env.DB.prepare('SELECT id,name,program,days,allergies,ss_weeks,school_year FROM students WHERE (active=1 AND school_year BETWEEN ? AND ?) OR id IN (SELECT student_id FROM attendance WHERE date BETWEEN ? AND ?) ORDER BY program,name COLLATE NOCASE').bind(schoolYear(from),schoolYear(to),from,to),
  env.DB.prepare('SELECT student_id,date,status FROM attendance WHERE date BETWEEN ? AND ?').bind(from,to),
  env.DB.prepare('SELECT id,name,program,date FROM trials WHERE date BETWEEN ? AND ? ORDER BY created_at').bind(from,to),
  env.DB.prepare("SELECT * FROM events WHERE start_date<=? AND ((recur IS NOT NULL AND recur!='none' AND (recur_until IS NULL OR recur_until='' OR recur_until>=?)) OR COALESCE(end_date,start_date)>=?)").bind(to,from,from),
  env.DB.prepare("SELECT id,title,program,month,school_year,song,vocab,activities,phonics FROM lessons WHERE kind='theme' ORDER BY created_at DESC"),
  env.DB.prepare('SELECT * FROM attendance_visits WHERE date BETWEEN ? AND ? ORDER BY created_at').bind(from,to),
  env.DB.prepare('SELECT * FROM summer_weeks WHERE school_year BETWEEN ? AND ?').bind(schoolYear(from),schoolYear(to))
 ]);
 const days=[];
 for(let time=Date.parse(from);time<=Date.parse(to);time+=86400000){
  const date=new Date(time).toISOString().slice(0,10),month=String(new Date(time).getUTCMonth()+1);
  const onDate=res=>({results:(res.results||[]).filter(row=>row.date===date)});
  days.push(shapeDay(date,{results:students.results.filter(s=>s.school_year===schoolYear(date)||marks.results.some(m=>m.date===date&&m.student_id===s.id))},onDate(marks),onDate(trials),events,{results:themes.results.filter(row=>String(row.month)===month && row.school_year===schoolYear(date))},onDate(visits),summer));
 }
 return json({days});
}
