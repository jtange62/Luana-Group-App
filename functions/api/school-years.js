import {json, verifyToken, bearer} from './_helpers.js';
import {validYear, shiftDate} from './_school-year.js';

export async function onRequestPost({request,env}) {
  if(!await verifyToken(env,bearer(request)))return json({error:'unauthorized'},401);
  let body;try{body=await request.json();}catch{return json({error:'bad request'},400);}
  const {from,to,kind}=body;
  if(!validYear(from)||!validYear(to)||Number(to)!==Number(from)+1||!['plans','roster'].includes(kind))return json({error:'Choose consecutive school years and plans or roster.'},400);
  const table=kind==='plans'?'lessons':'students';
  const scope=kind==='plans'?"kind='theme'":"active=1";
  const occupied=await env.DB.prepare(`SELECT id FROM ${table} WHERE school_year=? AND ${scope} LIMIT 1`).bind(to).first();
  if(occupied)return json({error:'The destination year already has '+kind+'. Nothing was changed.'},409);
  const source=await env.DB.prepare(`SELECT * FROM ${table} WHERE school_year=? AND ${scope}`).bind(from).all();
  if(!source.results.length)return json({error:'There are no '+kind+' to copy in that year.'},400);
  const statements=[env.DB.prepare('INSERT INTO school_year_copies(school_year,kind) VALUES (?,?)').bind(to,kind)];
  const uploaded=[];
  function insert(table,row){
    const columns=Object.keys(row);
    statements.push(env.DB.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...Object.values(row)));
  }
  try {
    for(const original of source.results){
      const id=crypto.randomUUID();
      const row={...original,id,school_year:Number(to),created_at:Date.now()};
      if(kind==='roster') {
        row.source_student_id=original.source_student_id||original.id;
        // Summer weeks are dated registrations, not reusable weekdays.
        if(row.program==='Summer School')row.ss_weeks='';
        insert('students',row);continue;
      }
      insert('lessons',row);
      const [weeks,files]=await env.DB.batch([
        env.DB.prepare('SELECT * FROM curriculum_weeks WHERE lesson_id=?').bind(original.id),
        env.DB.prepare('SELECT * FROM lesson_files WHERE lesson_id=?').bind(original.id)
      ]);
      for(const week of weeks.results||[]){
        const weekId=crypto.randomUUID();
        insert('curriculum_weeks',{...week,id:weekId,lesson_id:id,start_date:shiftDate(week.start_date,1),created_at:Date.now()});
        const days=await env.DB.prepare('SELECT * FROM week_days WHERE week_id=?').bind(week.id).all();
        for(const day of days.results||[])insert('week_days',{...day,id:crypto.randomUUID(),week_id:weekId,date:shiftDate(day.date,1),created_at:Date.now()});
      }
      for(const file of files.results||[]){
        const fileId=crypto.randomUUID(),object=await env.FILES.get(file.id);
        if(!object)throw Error('A source attachment could not be read. Nothing was copied.');
        uploaded.push(fileId);
        await env.FILES.put(fileId,object.body,{httpMetadata:object.httpMetadata});
        insert('lesson_files',{...file,id:fileId,lesson_id:id,created_at:Date.now()});
      }
    }
    // D1 batch is atomic; the unique marker also prevents duplicate copy requests.
    await env.DB.batch(statements);
    return json({ok:true,count:source.results.length});
  } catch(error) {
    await Promise.all(uploaded.map(id=>env.FILES.delete(id).catch(()=>{})));
    if(String(error).includes('UNIQUE'))return json({error:'This year has already been copied. Nothing was changed.'},409);
    return json({error:'Copy failed. No planning records were changed. Please try again.'},500);
  }
}
