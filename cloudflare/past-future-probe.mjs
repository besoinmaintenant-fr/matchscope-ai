// Temporary service-token-only, read-only comparison of historical and future
// fixture listings using the *same* Pages SPORTMONKS_API_TOKEN binding.
const EXPIRY=Date.parse('2026-11-01T21:00:00Z');
const ROOT='https://api.sportmonks.com/v3/football/fixtures/between/';
function json(status,payload){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})}
async function run(token,dates,leagueFilter,include){
  const url=new URL(ROOT+dates);
  url.searchParams.set('api_token',token);
  url.searchParams.set('per_page','5');
  url.searchParams.set('page','1');
  if(leagueFilter)url.searchParams.set('filters',leagueFilter);
  if(include)url.searchParams.set('include',include);
  try{
   const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(16000)});
   if(!r.ok)return {status:r.status,count:null,failed:true};
   const body=await r.json();
   const d=Array.isArray(body?.data)?body.data:null;
   const rate=body?.rate_limit;
   return {status:r.status,count:d?.length??null,
     ids:(d||[]).map(x=>({id:x.id,leagueId:x.league_id,stateId:x.state_id})),
     hasMore:Boolean(body?.pagination?.has_more),
     rateRemaining:Number.isFinite(Number(rate?.remaining))?Number(rate.remaining):null,
     rateResetsInSeconds:Number.isFinite(Number(rate?.resets_in_seconds))?Number(rate.resets_in_seconds):null,
     noDataMessage:typeof body?.message==='string'&&body.message.includes('subscription')?'SUBSCRIPTION_NOTICE':null};
  }catch(e){return {status:null,error:e?.name||'NETWORK_OR_PARSE_ERROR'}}
}
export async function onRequest({request,env}){
  if(request.method!=='POST')return json(405,{error:'POST_REQUIRED'});
  if(!request.headers.get('cf-access-jwt-assertion'))return json(403,{error:'ACCESS_REQUIRED'});
  if(Date.now()>EXPIRY)return json(410,{error:'EXPIRED'});
  if(!env.SPORTMONKS_API_TOKEN)return json(503,{error:'NO_TOKEN'});
  const ranges=[
    ['past_oct8_12','2026-10-08/2026-10-12','fixtureLeagues:301,384','league;participants;scores;state'],
    ['recent_oct25_31','2026-10-25/2026-10-31','fixtureLeagues:301,384','league;participants;scores;state'],
    ['today_to_nov15','2026-11-01/2026-11-15','fixtureLeagues:301,384','league;participants;scores;state'],
    ['today_to_nov15_five','2026-11-01/2026-11-15','fixtureLeagues:301,564,384,8,82','league;participants;venue'],
    ['today_to_nov15_no_include','2026-11-01/2026-11-15','fixtureLeagues:301,564,384,8,82',null],
    ['past_oct8_12_no_filter','2026-10-08/2026-10-12',null,'league']
  ];
  const out={};
  for(const [label,dates,filter,include] of ranges)out[label]=await run(env.SPORTMONKS_API_TOKEN,dates,filter,include);
  return json(200,{checkedAt:new Date().toISOString(),readonly:true,tests:out});
}
