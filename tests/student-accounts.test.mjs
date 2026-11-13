import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/student-accounts/handler.mjs';
const origin='https://spanmath.org';
const signup={action:'signup',username:'Map_Fox',password:'a good long password'};
function fixture(options={}) {
  const saved=[];const changes=[];const deletions=[];const calls=[];
  const admin={
    rpc:async(name,args)=>{calls.push({name,args});return {data:options.rateDenied?false:true,error:options.rpcError};},
    auth:{getUser:async token=>({data:{user:token==='valid'?{id:'verified-owner'}:null},error:null}),admin:{
      createUser:async value=>{changes.push(value);return {data:{user:options.duplicate?null:{id:'student-1'}},error:options.duplicate?{}:null};},
      deleteUser:async id=>{deletions.push(id);return {};},
      updateUserById:async(id,value)=>{changes.push({id,...value});return {};},
    }},
    from:table=>({insert:async value=>{saved.push({table,...value});return {error:options.storeError};}}),
  };
  const handler=createHandler(admin,[origin]);
  const request=(body=signup,headers={})=>handler(new Request('https://project.supabase.co/functions/v1/student-accounts',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
  return {request,saved,changes,deletions,calls,handler};
}
test('signup creates a class-independent username/password account without extra signup fields',async()=>{
  const f=fixture();const r=await f.request();assert.equal(r.status,200);const data=await r.json();
  assert.deepEqual(data,{username:'map_fox'});
  assert.equal(f.changes[0].email,'map_fox@students.span.invalid');assert.equal(f.changes[0].email_confirm,true);
  assert.deepEqual(f.changes[0].app_metadata,{role:'student',account_kind:'username'});
  assert.deepEqual(f.saved,[{table:'student_accounts',user_id:'student-1',username:'map_fox'}]);
});
test('rate limiter fails closed and denies before creating accounts',async()=>{
  for(const option of [{rateDenied:true},{rpcError:{message:'db unavailable'}}]) {
    const f=fixture(option);assert.ok([429,503].includes((await f.request()).status));assert.equal(f.changes.length,0);
  }
});
test('rejects invalid usernames, weak passwords, malformed JSON and oversized payloads',async()=>{
  const f=fixture();
  for(const body of [{...signup,username:'@bad'},{...signup,password:'tiny'}]) assert.equal((await f.request(body)).status,400);
  assert.equal((await f.request({...signup,padding:'x'.repeat(5000)})).status,413);
  assert.equal((await f.handler(new Request('https://example.com',{method:'POST',body:'{'}))).status,400);
});
test('unknown actions cannot change an existing account password',async()=>{
  const f=fixture();assert.equal((await f.request({...signup,action:'recover'})).status,400);
  assert.equal(f.changes.length,0);assert.equal(f.saved.length,0);
});
test('account deletion uses verified caller, ignores a supplied victim id',async()=>{
  const f=fixture();assert.equal((await f.request({action:'deleteAccount',userId:'victim'})).status,401);
  assert.equal((await f.request({action:'deleteAccount',userId:'victim'},{authorization:'Bearer invalid'})).status,401);
  assert.equal((await f.request({action:'deleteAccount',userId:'victim'},{authorization:'Bearer valid'})).status,200);
  assert.deepEqual(f.deletions,['verified-owner']);
});
test('cross-origin requests are rejected and incomplete signup rolls back its auth user',async()=>{
  const f=fixture({storeError:{}});assert.equal((await f.request(signup,{origin:'https://evil.example'})).status,403);
  assert.equal((await f.request()).status,503);assert.deepEqual(f.deletions,['student-1']);
});
