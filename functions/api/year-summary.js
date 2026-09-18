import {json,verifyToken,bearer} from './_helpers.js';
import {requestedYear} from './_school-year.js';
export async function onRequestGet({request,env}) {
  if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
  const year=requestedYear(new URL(request.url).searchParams.get('school_year'));
  if(year===null)return json({error:'Invalid school year'},400);
  const from=year+'-04-01',to=(year+1)+'-03-31';
  const [roster,marks,visits]=await env.DB.batch([
    env.DB.prepare('SELECT program,COUNT(*) AS count FROM students WHERE school_year=? AND active=1 GROUP BY program').bind(year),
    env.DB.prepare("SELECT s.program,a.status,COUNT(*) AS count FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM attendance_visits v WHERE v.student_id=a.student_id AND v.date=a.date) GROUP BY s.program,a.status").bind(from,to),
    env.DB.prepare('SELECT program,status,kind,COUNT(*) AS count FROM attendance_visits WHERE date BETWEEN ? AND ? GROUP BY program,status,kind').bind(from,to)
  ]);
  const lines=['Luana — '+year+'年度 ('+from+' to '+to+')','Recorded attendance totals; unmarked regular days are not counted.'];
  const programs=[...new Set([...roster.results,...marks.results,...visits.results].map(r=>r.program))];
  for(const program of programs){
    const count=roster.results.find(r=>r.program===program)?.count||0;
    lines.push('',program+' — '+count+' active roster registrations');
    for(const status of ['present','absent','late'])lines.push('  '+status+': '+[...marks.results,...visits.results].filter(r=>r.program===program&&r.status===status).reduce((n,r)=>n+r.count,0));
    for(const kind of ['makeup','trial','other'])lines.push('  '+kind+' bookings: '+visits.results.filter(r=>r.program===program&&r.kind===kind).reduce((n,r)=>n+r.count,0));
  }
  if(!programs.length)lines.push('No records for this school year.');
  return json({school_year:year,text:lines.join('\n')});
}
