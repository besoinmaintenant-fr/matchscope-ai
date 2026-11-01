// Temporary, read-only diagnostic under Cloudflare Access Service Auth.
// Must be deleted after testing. Never return provider URLs, tokens or raw payload.
const EXPIRES=Date.parse('2026-11-02T00:00:00Z');
const ROOT='https://api.sportmonks.com/v3/football';
function respond(status,body){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})}
async function call(token,from,to,filter,include='league') {
 const path='/fixtures/between/'+from+'/'+to;
 const url=new URL(ROOT+path);
 url.searchParams.set('api_token',token);
 url.searchParams.set('per_page','1');
 if(filter)url.searchParams.set('filters',filter);
 if(include)url.searchParams.set('include',include);
 try{
   const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
   if(!response.ok)return {status:response.status,received:null,error:'PROVIDER_HTTP'};
   const body=await response.json();
   const data=Array.isArray(body?.data)?body.data:null;
   if(!data)return {status:response.status,received:null,error:'UNEXPECTED_DATA'};
   return {status:response.status,received:data.length,
     sampleLeagueId:data[0]?.league_id??null,
     sampleFixtureId:data[0]?.id??null,
     hasMore:Boolean(body?.pagination?.has_more),
     total:typeof body?.pagination?.total==='number'?body.pagination.total:null,
     plans:Array.isArray(body?.subscription)?body.subscription.flatMap(x=>Array.isArray(x.plans)?x.plans.map(y=>String(y.plan||'').slice(0,60)):[]):[]};
 }catch(e){return {status:null,error:'PROVIDER_TIMEOUT_OR_NETWORK',cause:e?.name||'unknown'}}
}
export async function onRequest({request,env}){
 if(request.method!=='POST')return respond(405,{error:'METHOD_NOT_ALLOWED'});
 if(!request.headers.get('cf-access-jwt-assertion'))return respond(403,{error:'ACCESS_REQUIRED'});
 if(Date.now()>EXPIRES)return respond(410,{error:'EXPIRED'});
 if(!env.SPORTMONKS_API_TOKEN)return respond(503,{error:'SPORTMONKS_SECRET_ABSENT'});
 const now=new Date(),day=d=>d.toISOString().slice(0,10);
 const start=day(now),end14=day(new Date(now.getTime()+14*86400000)),
       end35=day(new Date(now.getTime()+35*86400000)),
       yesterday=day(new Date(now.getTime()-86400000)),
       twoAhead=day(new Date(now.getTime()+2*86400000));
 const selected='fixtureLeagues:301,564,384,8,82';
 const tasks=[
  ['future14_five',start,end14,selected],
  ['future35_five',start,end35,selected],
  ['yesterday_plus2_five',yesterday,twoAhead,selected],
  ['future14_PL',start,end14,'fixtureLeagues:8'],
  ['future14_no_filter',start,end14,null]
 ];
 const results={};
 for(const [name,from,to,filter] of tasks){
   results[name]=await call(env.SPORTMONKS_API_TOKEN,from,to,filter);
 }
 // Separate fixture fetch verifies that HTTP 200 means only an ID, not list entitlement.
 try {
   const url=new URL(ROOT+'/fixtures/19722114');url.searchParams.set('api_token',env.SPORTMONKS_API_TOKEN);
   const res=await fetch(url,{signal:AbortSignal.timeout(8500)});
   const body=res.ok?await res.json():null;
   results.referenceFixture={status:res.status,leagueId:body?.data?.league_id??null,id:body?.data?.id??null};
 }catch(e){results.referenceFixture={error:'REQUEST_FAILED',cause:e?.name||'unknown'}}
 return respond(200,{checkedAt:new Date().toISOString(),window:{from:start,to:end35},results,
    noWrites:true});
}
