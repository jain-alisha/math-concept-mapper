import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const alice='00000000-0000-0000-0000-000000000001',teacher='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('app_metadata',jsonb_build_object('role',current_setting('request.jwt.claim.role',true))) $$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant select on auth.users to authenticated;
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated,service_role;
`);
await db.exec(fs.readFileSync('supabase-schema.sql','utf8'));
await db.exec(fs.readFileSync('migrations/20261113_independent_student_accounts.sql','utf8'));
// Embedded Postgres cannot load the external scheduler. Test its cleanup SQL
// separately; production migration requires pg_cron instead of hiding failure.
const checkpoints=fs.readFileSync('migrations/20261113_checkpoints_and_retention.sql','utf8').replace(/create extension if not exists pg_cron;\nselect cron.schedule\([^\n]+\);/,'');
await db.exec(checkpoints);
await db.exec(fs.readFileSync('migrations/20261113_student_authorizations.sql','utf8'));
await db.exec(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
('${alice}','fox@students.span.invalid','{"display_name":"map_fox"}','{"account_kind":"username"}'),
('${teacher}','teacher@example.com','{}','{"role":"teacher"}'),('${other}','other@example.com','{}','{"role":"teacher"}');`);
const rows=async(sql,params=[]) => (await db.query(sql,params)).rows;
async function asUser(id,fn){await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);try{return await fn();}finally{await db.exec('reset role');}}
let ownMap,checkpoint,firstClass,secondClass,firstActivity,secondActivity;
test('one independent account can join two classes; no synthetic email leaks to roster',async()=>{
  firstClass=(await rows('insert into classes(teacher_id,name) values ($1,$2) returning *',[teacher,'Class A']))[0];
  secondClass=(await rows('insert into classes(teacher_id,name) values ($1,$2) returning *',[other,'Class B']))[0];
  await asUser(alice,async()=>{
    await rows('select * from join_class_by_code($1)',[firstClass.invite_code]);await rows('select * from join_class_by_code($1)',[secondClass.invite_code]);
    assert.equal((await rows('select * from classes')).length,2);
    const members=await rows('select * from class_members');assert.ok(members.every(x=>x.student_email===null));
    ownMap=(await rows('insert into maps(title,data) values ($1,$2) returning *',['My personal map',{n:[],e:[]}]))[0];
  });
});
test('class teachers can only see maps for their own activities, not other-class or personal work',async()=>{
  firstActivity=(await rows('insert into activities(class_id,name) values ($1,$2) returning *',[firstClass.id,'A activity']))[0];
  secondActivity=(await rows('insert into activities(class_id,name) values ($1,$2) returning *',[secondClass.id,'B activity']))[0];
  await asUser(alice,async()=>{
    await rows('insert into maps(title,data,activity_id) values ($1,$2,$3)',['A map',{},firstActivity.id]);
    await rows('insert into maps(title,data,activity_id) values ($1,$2,$3)',['B map',{},secondActivity.id]);
  });
  await asUser(teacher,async()=>{assert.deepEqual((await rows('select title from maps')).map(x=>x.title),['A map']);});
  await asUser(other,async()=>{assert.deepEqual((await rows('select title from maps')).map(x=>x.title),['B map']);});
});
test('starting checkpoint is immutable, grouped with mutable original, and can be copied',async()=>{
  await asUser(alice,async()=>{
    checkpoint=(await rows('select (public.save_starting_checkpoint($1)).*',[ownMap.id]))[0];
    assert.equal(checkpoint.is_checkpoint,true);assert.ok(checkpoint.timeline_id);
    assert.equal((await rows('select timeline_id from maps where id=$1',[ownMap.id]))[0].timeline_id,checkpoint.timeline_id);
    for(const assignment of ["data='{}'","title='changed'","is_checkpoint=false","updated_at=now()+interval '1 day'"])
      await assert.rejects(()=>rows(`update maps set ${assignment} where id=$1`,[checkpoint.id]),/read-only/);
    await rows('update maps set title=$1 where id=$2',['Working revision',ownMap.id]);
    const copy=(await rows('insert into maps(title,data,timeline_id) select $1,data,timeline_id from maps where id=$2 returning *',['Recovered working copy',checkpoint.id]))[0];
    assert.equal(copy.is_checkpoint,false);
    await assert.rejects(()=>rows('insert into maps(title,data,is_checkpoint) values ($1,$2,true)',['Fake snapshot',{}]),/row-level security/);
  });
  await asUser(other,async()=>{await assert.rejects(()=>rows('select public.save_starting_checkpoint($1)',[ownMap.id]),/Map not found/);});
});
test('daily retention deletes expired maps while retaining recently edited work',async()=>{
  // A database owner seeds age, simulating passage of time rather than a client clock.
  await db.exec('alter table maps disable trigger all');
  const old=(await rows("insert into maps(owner_id,title,data,updated_at) values ($1,'Expired','{}',now()-interval '13 months') returning id",[alice]))[0];
  await db.exec('alter table maps enable trigger all');
  const result=await rows('select expire_span_maps() as count');assert.equal(result[0].count,1);
  assert.equal((await rows('select id from maps where id=$1',[old.id])).length,0);
  assert.equal((await rows('select id from maps where id=$1',[ownMap.id])).length,1);
});
test('recovery hashes, adult authorizations, and rate-limit RPC are inaccessible to students',async()=>{
  await asUser(alice,async()=>{
    await assert.rejects(()=>rows('select * from student_accounts'),/permission denied/);
    await assert.rejects(()=>rows('select * from student_authorizations'),/permission denied/);
    await assert.rejects(()=>rows("select consume_student_account_attempt('x',5)"),/permission denied/);
  });
  for(let i=0;i<6;i++) assert.equal((await rows("select consume_student_account_attempt('recover:fox',5) as ok"))[0].ok,i<5);
  await rows("insert into student_authorizations(code_hash,authority,evidence_reference,verified_at,expires_at,max_accounts) values ('hash','school','private-ref',now(),now()+interval '1 day',1)");
  assert.ok((await rows("select claim_student_authorization('hash') as id"))[0].id);
  assert.equal((await rows("select claim_student_authorization('hash') as id"))[0].id,null);
});
test('deleting auth account cascades maps, timelines, class memberships and recovery data',async()=>{
  await rows('insert into student_accounts(user_id,username,recovery_hash) values ($1,$2,$3)',[alice,'map_fox','a'.repeat(64)]);
  await rows('delete from auth.users where id=$1',[alice]);
  for(const [table,column] of [['maps','owner_id'],['map_timelines','owner_id'],['class_members','student_id'],['student_accounts','user_id']])
    assert.equal((await rows(`select * from ${table} where ${column}=$1`,[alice])).length,0);
  assert.equal((await rows('select * from classes')).length,2);
  await db.close();
});
