// One-time read-only historical coverage check. This route is gated by the
// existing Cloudflare Access Service Auth application for /__cron/*.
// Expiration is a second safeguard; delete the route after the diagnostic.
const EXPIRES_AT = Date.parse('2026-11-01T13:00:00Z');
const API = 'https://api.sportmonks.com/v3/football/fixtures/between/2026-10-08/2026-10-12';

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status, headers: {'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'}
  });
}
function scoresForFixture(fixture) {
  let home=null,away=null;
  for (const item of (Array.isArray(fixture?.scores)?fixture.scores:[])) {
    if (item?.description!=='CURRENT') continue;
    const value=Number(item?.score?.goals);
    if (!Number.isFinite(value)) continue;
    if (item?.score?.participant==='home') home=value;
    if (item?.score?.participant==='away') away=value;
  }
  return {home,away};
}
export async function onRequest({request,env}) {
  if (request.method!=='POST') return respond(405,{error:'METHOD_NOT_ALLOWED'});
  if (!request.headers.get('cf-access-jwt-assertion'))
    return respond(403,{error:'CLOUDFLARE_ACCESS_REQUIRED'});
  if (Date.now()>=EXPIRES_AT) return respond(410,{error:'PROBE_EXPIRED'});
  if (!env.SPORTMONKS_API_TOKEN) return respond(503,{error:'SPORTMONKS_TOKEN_MISSING'});
  const url=new URL(API);
  url.searchParams.set('api_token',env.SPORTMONKS_API_TOKEN);
  url.searchParams.set('filters','fixtureLeagues:301,384');
  url.searchParams.set('include','league;participants;scores;state');
  url.searchParams.set('per_page','50');
  url.searchParams.set('page','1');
  try {
    const res=await fetch(url.toString(),{signal:AbortSignal.timeout(25000)});
    // Never emit the request URL, provider body, token, or raw errors.
    if (!res.ok) return respond(200,{success:false,providerStatus:res.status,
      authorized:res.status!==401&&res.status!==403, fixtures:0});
    const data=await res.json();
    if (!Array.isArray(data?.data))return respond(502,{success:false,error:'UNEXPECTED_PROVIDER_RESPONSE'});
    const stats={SA:{seen:0,finishedWithScore:0,sample:null},L1:{seen:0,finishedWithScore:0,sample:null}};
    for(const f of data.data) {
      const code=Number(f?.league_id)===384?'SA':Number(f?.league_id)===301?'L1':null;
      if(!code)continue;
      stats[code].seen++;
      const finished=[5,7,8].includes(Number(f?.state_id));
      const score=scoresForFixture(f);
      if(finished && score.home!==null && score.away!==null)stats[code].finishedWithScore++;
      if(stats[code].sample===null && finished && score.home!==null && score.away!==null) {
        const participants=Array.isArray(f?.participants)?f.participants:[];
        stats[code].sample={fixtureId:Number(f.id),kickoff:f.starting_at,
          home:participants.find(x=>x?.meta?.location==='home')?.name||null,
          away:participants.find(x=>x?.meta?.location==='away')?.name||null,
          homeScore:score.home,awayScore:score.away,stateId:Number(f.state_id)};
      }
    }
    return respond(200,{success:true,providerStatus:res.status,
      queriedRange:'2026-10-08/2026-10-12',
      leagueFilter:['SA','L1'],returned:data.data.length,
      morePages:Boolean(data?.pagination?.has_more),byLeague:stats});
  }catch(e){
    console.error('Sportmonks historical probe request failed',e?.name||'unknown');
    return respond(502,{success:false,error:'PROVIDER_NETWORK_OR_PARSE_FAILURE'});
  }
}
