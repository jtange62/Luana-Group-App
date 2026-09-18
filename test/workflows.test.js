import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { makeToken } from '../functions/api/_helpers.js';
import { onRequestPost as place } from '../functions/api/post-place.js';
import { onRequestGet as posts } from '../functions/api/posts.js';
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
