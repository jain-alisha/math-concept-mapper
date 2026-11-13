import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,hashKey} from '../supabase/functions/student-accounts/handler.mjs';
const origin='https://spanmath.org';
const signup={action:'signup',username:'Map_Fox',password:'a good long password',ageBand:'13plus'};
function fixture(options={}) {
  const saved=[];const changes=[];const deletions=[];const calls=[];
  const admin={
    rpc:async(name,args)=>{calls.push({name,args});return {data:options.rateDenied?false:name==='claim_student_authorization'?(options.approval||null):true,error:options.rpcError};},
    auth:{getUser:async token=>({data:{user:token==='valid'?{id:'verified-owner'}:null},error:null}),admin:{
      createUser:async value=>{changes.push(value);return {data:{user:options.duplicate?null:{id:'student-1'}},error:options.duplicate?{}:null};},
      deleteUser:async id=>{deletions.push(id);return {};},
      updateUserById:async(id,value)=>{changes.push({id,...value});return {};},
    }},
    from:table=>({insert:async value=>{saved.push({table,...value});return {error:options.storeError};},select:()=>{
      const query={};const q={eq:(key,value)=>{query[key]=value;return q;},maybeSingle:async()=>({data:options.recovery && query.recovery_hash===options.recovery?{user_id:'student-1'}:null})};return q;
    }}),
  };
  const handler=createHandler(admin,[origin]);
  const request=(body=signup,headers={})=>handler(new Request('https://project.supabase.co/functions/v1/student-accounts',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
  return {request,saved,changes,deletions,calls,handler};
}
test('signup creates a class-independent student, saves only hashed recovery secret',async()=>{
  const f=fixture();const r=await f.request();assert.equal(r.status,200);const data=await r.json();
  assert.equal(data.username,'map_fox');assert.match(data.recoveryKey,/^[a-f0-9-]+$/);
  assert.equal(f.changes[0].email,'map_fox@students.span.invalid');assert.equal(f.changes[0].email_confirm,true);
  assert.deepEqual(f.changes[0].app_metadata,{role:'student',account_kind:'username'});
  assert.equal(f.saved[0].recovery_hash,await hashKey(data.recoveryKey.replaceAll('-','')));
  assert.equal(f.saved[0].class_id,undefined);assert.equal(f.saved[0].recoveryKey,undefined);
});
test('under-13 signup requires a verified adult authorization and releases capacity on failure',async()=>{
  const no=fixture();assert.equal((await no.request({...signup,ageBand:'under13'})).status,400);assert.equal(no.changes.length,0);
  const f=fixture({approval:'approved-1',duplicate:true});
  assert.equal((await f.request({...signup,ageBand:'under13',authorizationCode:'a'.repeat(40)})).status,400);
  assert.ok(f.calls.some(x=>x.name==='release_student_authorization'));
});
test('under-13 signup records the approved authorization independent of class',async()=>{
  const f=fixture({approval:'approved-1'});assert.equal((await f.request({...signup,ageBand:'under13',authorizationCode:'a'.repeat(40)})).status,200);
  assert.equal(f.saved[0].authorization_id,'approved-1');assert.equal(f.saved[0].age_band,'under13');
});
test('rate limiter fails closed and denies before creating accounts',async()=>{
  for(const option of [{rateDenied:true},{rpcError:{message:'db unavailable'}}]) {
    const f=fixture(option);assert.ok([429,503].includes((await f.request()).status));assert.equal(f.changes.length,0);
  }
});
test('rejects invalid usernames, weak passwords, malformed JSON and oversized payloads',async()=>{
  const f=fixture();
  for(const body of [{...signup,username:'@bad'},{...signup,password:'tiny'},{...signup,ageBand:'invalid'}]) assert.equal((await f.request(body)).status,400);
  assert.equal((await f.request({...signup,padding:'x'.repeat(5000)})).status,413);
  assert.equal((await f.handler(new Request('https://example.com',{method:'POST',body:'{'}))).status,400);
});
test('recovery requires the correct secret and updates the same account id',async()=>{
  const key='a'.repeat(40);const f=fixture({recovery:await hashKey(key)});
  assert.equal((await f.request({...signup,action:'recover',recoveryKey:'b'.repeat(40)})).status,400);assert.equal(f.changes.length,0);
  assert.equal((await f.request({...signup,action:'recover',recoveryKey:key})).status,200);
  assert.deepEqual(f.changes,[{id:'student-1',password:signup.password}]);
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
