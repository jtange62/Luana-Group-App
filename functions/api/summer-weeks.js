import {json,verifyToken,bearer} from './_helpers.js';
import {requestedYear,schoolYear} from './_school-year.js';
import {validDate} from './visits.js';
export async function onRequestGet({request,env}) {
  if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
  const year=requestedYear(new URL(request.url).searchParams.get('school_year'));
  if(year===null)return json({error:'Invalid school year'},400);
  const rows=await env.DB.prepare('SELECT id,start,end FROM summer_weeks WHERE school_year=? ORDER BY start').bind(year).all();
  return json({weeks:rows.results||[]});
}
export async function onRequestPost({request,env}) {
  if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
  let body;try{body=await request.json();}catch{return json({error:'bad request'},400);}
  const year=requestedYear(body.school_year),weeks=body.weeks;
  if(year===null||!Array.isArray(weeks)||weeks.length>12)return json({error:'Invalid summer dates'},400);
  const ids=new Set();
  for(const w of weeks){
    if(!/^([1-9]|1[0-2])$/.test(w.id)||ids.has(w.id)||!validDate(w.start)||!validDate(w.end)||w.start>w.end||schoolYear(w.start)!==year||schoolYear(w.end)!==year)return json({error:'Use unique week numbers and dates within the selected school year.'},400);
    ids.add(w.id);
  }
  const sorted=weeks.slice().sort((a,b)=>a.start.localeCompare(b.start));
  if(sorted.some((w,i)=>i&&w.start<=sorted[i-1].end))return json({error:'Summer weeks cannot overlap.'},400);
  await env.DB.batch([env.DB.prepare('DELETE FROM summer_weeks WHERE school_year=?').bind(year),...weeks.map(w=>env.DB.prepare('INSERT INTO summer_weeks(school_year,id,start,end) VALUES (?,?,?,?)').bind(year,w.id,w.start,w.end))]);
  return json({ok:true});
}
