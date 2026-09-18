import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { makeToken } from '../functions/api/_helpers.js';
import { onRequestPost as place } from '../functions/api/post-place.js';
import { onRequestGet as posts } from '../functions/api/posts.js';
import { onRequestDelete as deleteEvent } from '../functions/api/event.js';
import { buildToday } from '../functions/api/_today.js';

function database(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => sql.close());
  return {
    sql,
    prepare(query) {
      const statement = sql.prepare(query); let args = [];
      return {
        bind(...values) { args = values; return this; },
        async all() { return {results:statement.all(...args)}; },
        async first() { return statement.get(...args) || null; },
        async run() { return this.execute(); },
        execute() {
          if (statement.columns().length) return { results: statement.all(...args) };
          return { meta: { changes: statement.run(...args).changes } };
        }
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); sql.exec('COMMIT'); return results; }
      catch(error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
}
const SESSION_SECRET = 'workflow-test-secret';
async function request(path, body) {
  return new Request('https://example.test/api/' + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + await makeToken({SESSION_SECRET}), 'Content-Type': 'application/json' },
    ...(body ? {body: JSON.stringify(body)} : {})
  });
}
function seed(DB,id,text,created=1,category='curriculum',placed=null) {
  DB.sql.prepare('INSERT INTO posts (id,author,text,category,created_at,placed_at) VALUES (?,?,?,?,?,?)').run(id,'tester',text,category,created,placed);
}

test('simultaneous curriculum filing keeps both ideas and refuses a duplicate', async t => {
  const DB=database(t); const env={DB,SESSION_SECRET};
  DB.sql.prepare('INSERT INTO lessons (id,title,author,created_at,activities) VALUES (?,?,?,?,?)').run('theme','Test','tester',1,'Existing activity');
  seed(DB,'a','Paint leaves'); seed(DB,'b','Sing a song');
  const submit=async id => place({env,request:await request('post-place',{post_id:id,type:'theme',target_id:'theme',field:'activities'})});
  const results=await Promise.all([submit('a'),submit('b'),submit('a')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,200,409]);
  const lines=DB.sql.prepare('SELECT activities FROM lessons').get().activities.split('\n');
  assert.equal(lines.length,3); assert.ok(lines.includes('Paint leaves')); assert.ok(lines.includes('Sing a song'));
});

test('open inbox finds older ideas and counts all open posts independently of pages',async t=>{
  const DB=database(t);const env={DB,SESSION_SECRET};
  for(let i=1;i<=35;i++) seed(DB,'filed'+i,'Done',i,'general',1);
  seed(DB,'older','Still needed',0,'supplies');seed(DB,'newer','Plan',40);
  const data=await (await posts({env,request:await request('posts?placed=0&limit=1&counts=1')})).json();
  assert.equal(data.open_count,2);assert.equal(data.posts[0].id,'newer');assert.equal(data.has_more,true);
  const next=await (await posts({env,request:await request('posts?placed=0&limit=1&before='+encodeURIComponent(data.next_cursor))})).json();
  assert.equal(next.posts[0].id,'older');
  const filtered=await (await posts({env,request:await request('posts?category=supplies&counts=1')})).json();
  assert.deepEqual(filtered.posts.map(p=>p.id),['older']); assert.equal(filtered.open_count,2);
  assert.equal((await place({env,request:await request('post-place',{post_id:'older',action:'complete'})})).status,200);
  const remaining=await (await posts({env,request:await request('posts?placed=0&counts=1')})).json();
  assert.equal(remaining.open_count,1);assert.deepEqual(remaining.posts.map(p=>p.id),['newer']);
});

test('completed filter preserves pagination and search while keeping curriculum shares visible',async t=>{
  const DB=database(t);const env={DB,SESSION_SECRET};
  seed(DB,'older','Find this',1);seed(DB,'filed','Find curriculum',2,'general',1);
  seed(DB,'done','Find completed',3);
  await place({env,request:await request('post-place',{post_id:'done',action:'complete'})});
  const get=async query=>(await posts({env,request:await request('posts?'+query)})).json();
  const first=await get('completed=0&q=Find&limit=1');
  assert.deepEqual(first.posts.map(p=>p.id),['filed']);assert.equal(first.has_more,true);
  const next=await get('completed=0&q=Find&limit=1&before='+encodeURIComponent(first.next_cursor));
  assert.deepEqual(next.posts.map(p=>p.id),['older']);assert.equal(next.has_more,false);
  assert.deepEqual((await get('q=Find')).posts.map(p=>p.id),['done','filed','older']);
});

test('staff can delete shared calendar events and recurring series',async t=>{
  const DB=database(t);const env={DB,SESSION_SECRET};
  DB.sql.prepare("INSERT INTO events (id,title,author,calendar,start_date,recur,created_at) VALUES ('series','Weekly meeting','another teacher','general','2026-09-01','weekly',1)").run();
  const makeRequest=async authenticated=>new Request('https://example.test/api/event',{method:'DELETE',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+await makeToken(env)}:{})},body:JSON.stringify({id:'series',author:'tester'})});
  assert.equal((await deleteEvent({env,request:await makeRequest(false)})).status,401);
  assert.equal((await deleteEvent({env,request:await makeRequest(true)})).status,200);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
});

test('official holidays include substitute and citizens holidays without annual repetition',()=>{
  const data=JSON.parse(readFileSync(new URL('../public/tools/calendar/holidays.json',import.meta.url),'utf8'));
  const dates=new Map(data.holidays.map(h=>[h.date,h.name]));
  assert.equal(dates.size,data.holidays.length);
  for(const date of ['2026-05-06','2026-09-22','2027-03-22'])assert.ok(dates.get(date));
  assert.equal(dates.get('2026-09-21'),'敬老の日');
  assert.equal(dates.get('2027-09-20'),'敬老の日');
  assert.equal(dates.has('2027-09-21'),false);
});

test('Summer School attendance respects selected weeks, breaks and year',async t=>{
  const DB=database(t);
  DB.sql.prepare('INSERT INTO students (id,name,program,days,ss_weeks,active,created_at) VALUES (?,?,?,?,?,1,1)').run('summer','Summer student','Summer School','1,2,3,4,5','1,3');
  for(const [day,expected] of [['2026-07-27',1],['2026-08-03',0],['2026-08-10',0],['2026-08-17',1],['2026-09-18',0],['2027-07-27',0]]) {
    assert.equal((await buildToday(DB,day)).totals.expected,expected,day);
  }
});
import { onRequestPost as createPost } from '../functions/api/post.js';

test('caption-free uploads appear in matching resource filters and filename search',async t=>{
 const DB=database(t);const objects=new Map();const env={DB,SESSION_SECRET,FILES:{async put(id,bytes){objects.set(id,bytes);},async delete(id){objects.delete(id);}}};
 const form=new FormData();form.set('author','tester');form.append('files',new File(['photo'],'leaf.jpg',{type:'image/jpeg'}));form.append('files',new File(['worksheet'],'leaves.pdf',{type:'application/pdf'}));
 const req=new Request('https://example.test/api/post',{method:'POST',headers:{Authorization:'Bearer '+await makeToken(env)},body:form});
 const response=await createPost({env,request:req});assert.equal(response.status,200);
 const {id}=await response.json();assert.equal(objects.size,2);
 for(const filter of ['resource=photos&q=leaf.jpg','resource=files&q=leaves.pdf']) {
  const data=await(await posts({env,request:await request('posts?'+filter)})).json();assert.deepEqual(data.posts.map(p=>p.id),[id]);
 }
 const links=await(await posts({env,request:await request('posts?resource=links')})).json();assert.equal(links.posts.length,0);
});

test('failed upload leaves no partial post and removes previously uploaded files',async t=>{
 const DB=database(t);const removed=[];let puts=0;
 const env={DB,SESSION_SECRET,FILES:{async put(){if(++puts===2)throw new Error('storage failure');},async delete(id){removed.push(id);}}};
 const form=new FormData();form.append('files',new File(['one'],'one.txt'));form.append('files',new File(['two'],'two.txt'));
 await assert.rejects(async()=>createPost({env,request:new Request('https://example.test/api/post',{method:'POST',headers:{Authorization:'Bearer '+await makeToken(env)},body:form})}),/storage failure/);
 assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM posts').get().n,0);assert.equal(removed.length,1);
});
import {onRequestPost as bookVisit,onRequestPatch as markVisit,onRequestDelete as cancelVisit} from '../functions/api/visits.js';
import {onRequestGet as getPlanner} from '../functions/api/planner.js';

test('makeup booking keeps its class and reason after marking absent, and cancels cleanly',async t=>{
 const DB=database(t),env={DB,SESSION_SECRET};
 DB.sql.prepare('INSERT INTO students(id,name,program,days,active,created_at) VALUES (?,?,?,?,1,1)').run('s1','Aiko','Preschool','1');
 const booked=await bookVisit({env,request:await request('visits',{student_id:'s1',program:'Kinder',date:'2026-09-21',kind:'makeup'})});
 assert.equal(booked.status,200);const {id}=await booked.json();
 let day=await buildToday(DB,'2026-09-21');assert.equal(day.programs.length,1);assert.equal(day.programs[0].program,'Kinder');assert.equal(day.programs[0].guests[0].kind,'makeup');
 assert.equal((await bookVisit({env,request:await request('visits',{student_id:'s1',program:'Kinder',date:'2026-09-21',kind:'makeup'})})).status,409);
 await markVisit({env,request:await request('visits',{id,status:'absent'})});
 day=await buildToday(DB,'2026-09-21');assert.equal(day.programs[0].guests[0].kind,'makeup');assert.equal(day.programs[0].guests[0].status,'absent');
 const period=await(await getPlanner({env,request:await request('planner?from=2026-09-21&to=2026-09-27')})).json();
 assert.equal(period.days.length,7);assert.equal(period.days[0].programs[0].guests[0].visit_id,id);
 await cancelVisit({env,request:await request('visits',{id})});
 day=await buildToday(DB,'2026-09-21');assert.equal(day.programs[0].program,'Preschool');assert.equal(day.programs[0].expected.length,1);
});

test('trial visitor can be booked and marked without creating a roster profile',async t=>{
 const DB=database(t),env={DB,SESSION_SECRET};
 const {id}=await(await bookVisit({env,request:await request('visits',{name:'New child',program:'Kinder',date:'2026-09-22',kind:'trial'})})).json();
 await markVisit({env,request:await request('visits',{id,status:'present'})});
 const day=await buildToday(DB,'2026-09-22');assert.equal(day.programs[0].guests[0].kind,'trial');assert.equal(day.totals.present,1);
 assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM students').get().n,0);
});

test('planner rejects impossible, reversed and oversized date ranges',async t=>{
 const DB=database(t),env={DB,SESSION_SECRET};
 for(const query of ['from=2026-02-30&to=2026-03-01','from=2026-09-30&to=2026-09-01','from=2026-01-01&to=2026-12-31'])assert.equal((await getPlanner({env,request:await request('planner?'+query)})).status,400);
});

test('planning migration preserves legacy makeup and trial bookings without double-counting',async t=>{
 const DB=database(t),env={DB,SESSION_SECRET};
 DB.sql.prepare('INSERT INTO students(id,name,program,days,active,created_at) VALUES (?,?,?,?,1,1)').run('old-student','Legacy student','Kinder','1');
 DB.sql.prepare('INSERT INTO attendance(id,student_id,date,status,created_at) VALUES (?,?,?,?,1)').run('old-mark','old-student','2026-09-22','makeup');
 DB.sql.prepare('INSERT INTO trials(id,name,program,date,created_at) VALUES (?,?,?,?,1)').run('old-trial','Legacy trial','Kinder','2026-09-22');
 const migration=readFileSync(new URL('../migrations/022_attendance_planning.sql',import.meta.url),'utf8');
 DB.sql.exec(migration);DB.sql.exec(migration);
 let day=await buildToday(DB,'2026-09-22');assert.equal(day.programs[0].guests.length,2);assert.equal(day.programs[0].trials.length,0);
 await markVisit({env,request:await request('visits',{id:'legacy-old-mark',status:'present'})});
 day=await buildToday(DB,'2026-09-22');assert.equal(day.programs[0].guests.find(s=>s.id==='old-student').kind,'makeup');
 await cancelVisit({env,request:await request('visits',{id:'legacy-trial-old-trial'})});
 await cancelVisit({env,request:await request('visits',{id:'legacy-old-mark'})});
 day=await buildToday(DB,'2026-09-22');assert.equal(day.programs.length,0);
});

import {schoolYear,shiftDate} from '../functions/api/_school-year.js';
import {onRequestPost as copySchoolYear} from '../functions/api/school-years.js';
import {onRequestPost as createEvent} from '../functions/api/event.js';
import {onRequestGet as eventsGet} from '../functions/api/events.js';
import {onRequestGet as studentsGet} from '../functions/api/students.js';
import {onRequestGet as lessonsGet} from '../functions/api/lessons.js';
import {onRequestGet as plannerGet} from '../functions/api/planner.js';
import {onRequestGet as yearSummary} from '../functions/api/year-summary.js';

test('Japanese school years change on April 1 and leap dates copy safely',()=>{
  assert.equal(schoolYear('2027-03-31'),2026);assert.equal(schoolYear('2027-04-01'),2027);
  assert.equal(shiftDate('2028-02-29',1),'2029-02-28');
});
test('rosters and January themes are isolated by school year across a planner range',async t=>{
  const DB=database(t),env={DB,SESSION_SECRET};
  for(const y of [2026,2027]){
    DB.sql.prepare("INSERT INTO students(id,name,program,days,created_at,school_year) VALUES (?,?, 'Kinder','0,1,2,3,4,5,6',1,?)").run('s'+y,'Student '+y,y);
    DB.sql.prepare("INSERT INTO lessons(id,title,author,program,month,kind,created_at,school_year) VALUES (?,?,'tester','Kinder','1','theme',1,?)").run('l'+y,'Theme '+y,y);
  }
  const roster=await(await studentsGet({env,request:await request('students?school_year=2027')})).json();
  assert.deepEqual(roster.students.map(s=>s.id),['s2027']);
  const themes=await(await lessonsGet({env,request:await request('lessons?kind=theme&school_year=2026')})).json();
  assert.deepEqual(themes.lessons.map(s=>s.id),['l2026']);
  const january=await buildToday(DB,'2027-01-08');assert.equal(january.programs[0].theme.id,'l2026');
  const range=await(await plannerGet({env,request:await request('planner?from=2027-03-31&to=2027-04-01')})).json();
  assert.equal(range.days[0].programs[0].expected[0].id,'s2026');assert.equal(range.days[1].programs[0].expected[0].id,'s2027');
});
test('copying a school year preserves originals, files and weekly plans without copying attendance or reflections',async t=>{
  const DB=database(t),objects=new Map([['file','photo']]);
  const env={DB,SESSION_SECRET,FILES:{async get(id){return objects.has(id)?{body:objects.get(id),httpMetadata:{}}:null;},async put(id,body){objects.set(id,body);},async delete(id){objects.delete(id);}}};
  DB.sql.prepare("INSERT INTO lessons(id,title,author,program,month,kind,created_at) VALUES ('plan','Ocean','tester','Kinder','1','theme',1)").run();
  DB.sql.prepare("INSERT INTO curriculum_weeks(id,lesson_id,week_no,start_date,focus,created_at) VALUES ('week','plan',1,'2027-01-11','Fish',1)").run();
  DB.sql.prepare("INSERT INTO week_days(id,week_id,date,subtheme,created_at) VALUES ('day','week','2027-01-12','Sharks',1)").run();
  DB.sql.prepare("INSERT INTO week_comments(id,week_id,author,text,created_at) VALUES ('comment','week','tester','Past reflection',1)").run();
  DB.sql.prepare("INSERT INTO lesson_files(id,lesson_id,filename,created_at) VALUES ('file','plan','photo.png',1)").run();
  const copy=async kind=>copySchoolYear({env,request:await request('school-years',{from:2026,to:2027,kind})});
  assert.equal((await copy('plans')).status,200);assert.equal((await copy('plans')).status,409);
  const plan=DB.sql.prepare('SELECT * FROM lessons WHERE school_year=2027').get();assert.equal(plan.title,'Ocean');
  const week=DB.sql.prepare('SELECT * FROM curriculum_weeks WHERE lesson_id=?').get(plan.id);assert.equal(week.start_date,'2028-01-11');
  assert.equal(DB.sql.prepare('SELECT date FROM week_days WHERE week_id=?').get(week.id).date,'2028-01-12');
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM week_comments').get().n,1);
  const file=DB.sql.prepare('SELECT id FROM lesson_files WHERE lesson_id=?').get(plan.id);assert.equal(objects.get(file.id),'photo');assert.notEqual(file.id,'file');
  DB.sql.prepare("UPDATE lessons SET title='Changed' WHERE id=?").run(plan.id);assert.equal(DB.sql.prepare("SELECT title FROM lessons WHERE id='plan'").get().title,'Ocean');
  DB.sql.prepare("INSERT INTO students(id,name,program,days,created_at) VALUES ('student','Aiko','Kinder','1',1)").run();
  DB.sql.prepare("INSERT INTO attendance(id,student_id,date,status,created_at) VALUES ('mark','student','2027-01-11','present',1)").run();
  assert.equal((await copy('roster')).status,200);
  const student=DB.sql.prepare('SELECT * FROM students WHERE school_year=2027').get();assert.equal(student.source_student_id,'student');assert.notEqual(student.id,'student');
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,1);
  const summary=await(await yearSummary({env,request:await request('year-summary?school_year=2026')})).json();assert.match(summary.text,/present: 1/);
});
test('school closures span dates and suppress only the selected class while preserving booked visits',async t=>{
  const DB=database(t),env={DB,SESSION_SECRET};
  for(const program of ['Kinder','Preschool'])DB.sql.prepare("INSERT INTO students(id,name,program,days,created_at) VALUES (?,?,?,'0,1,2,3,4,5,6',1)").run(program,program,program);
  const response=await createEvent({env,request:await request('event',{title:'Winter break',calendar:'general',event_type:'closure',program:'Kinder',start_date:'2026-12-25',end_date:'2027-01-05'})});assert.equal(response.status,200);
  const eventList=await(await eventsGet({env,request:await request('events?from=2027-01-01&to=2027-01-31')})).json();assert.equal(eventList.events.length,1);
  const day=await buildToday(DB,'2027-01-04');assert.deepEqual(day.programs.map(p=>p.program),['Preschool']);assert.match(day.events[0].title,/Closed/);
  assert.equal((await buildToday(DB,'2027-01-06')).programs.length,2);
});

import {onRequestPost as saveSummer} from '../functions/api/summer-weeks.js';
test('summer schedules are configured independently for each school year',async t=>{
  const DB=database(t),env={DB,SESSION_SECRET};
  DB.sql.prepare("INSERT INTO students(id,name,program,days,ss_weeks,school_year,created_at) VALUES ('summer27','Summer child','Summer School','1','1',2027,1)").run();
  assert.equal((await buildToday(DB,'2027-07-26')).totals.expected,0);
  assert.equal((await saveSummer({env,request:await request('summer-weeks',{school_year:2027,weeks:[{id:'1',start:'2027-07-26',end:'2027-07-30'}]})})).status,200);
  assert.equal((await buildToday(DB,'2027-07-26')).totals.expected,1);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) AS n FROM summer_weeks WHERE school_year=2026').get().n,3);
  assert.equal((await saveSummer({env,request:await request('summer-weeks',{school_year:2027,weeks:[{id:'1',start:'2026-07-26',end:'2026-07-30'}]})})).status,400);
});
test('school-year migration adds scope without removing existing records',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("CREATE TABLE lessons(id TEXT,kind TEXT,program TEXT,month TEXT); CREATE TABLE students(id TEXT,active INTEGER,program TEXT); CREATE TABLE events(id TEXT,title TEXT); INSERT INTO lessons VALUES ('existing-plan','theme','Kinder','1'); INSERT INTO students VALUES ('existing-student',1,'Kinder'); INSERT INTO events VALUES ('existing-event','School meeting');");
    db.exec(readFileSync(new URL('../migrations/023_school_year.sql',import.meta.url),'utf8'));
    assert.equal(db.prepare('SELECT school_year FROM lessons').get().school_year,2026);
    assert.equal(db.prepare('SELECT id FROM students').get().id,'existing-student');
    assert.equal(db.prepare('SELECT title FROM events').get().title,'School meeting');
  }finally{db.close();}
});
