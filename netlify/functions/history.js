'use strict';
const {supabaseRequest}=require('./lib/supabase');
const LEAGUES={PL:'Premier League',BL:'Bundesliga',LL:'La Liga',SA:'Serie A',L1:'Ligue 1'};
const TERMINAL=new Set([5,7,8]);
function response(statusCode,data){return {statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(data)};}
function transform(row,now=Date.now()){
 const ts=Date.parse(row?.starting_at);
 const home=Number(row?.results?.home_score);
 const away=Number(row?.results?.away_score);
 const code=String(row?.league_code||'');
 const result=row?.results?.result_1x2;
 if(!Number.isFinite(ts)||ts>now||!Object.hasOwn(LEAGUES,code)||
    row?.results?.home_score==null||row?.results?.away_score==null||
    !Number.isSafeInteger(home)||home<0||!Number.isSafeInteger(away)||away<0||
    !['1','N','2'].includes(result)||
    (home>away?'1':home<away?'2':'N')!==result)return null;
 const date=new Date(ts);
 return {id:String(row.sportmonks_fixture_id),mode:'history',finished:true,
  stateId:5,competition:code,competitionName:row.league_name||LEAGUES[code],
  home:row.home_team_name||'Domicile',away:row.away_team_name||'Extérieur',
  homeId:row.home_team_id,awayId:row.away_team_id,
  startingAt:date.toISOString(),kickoffTs:ts,
  date:date.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric',timeZone:'Europe/Paris'}),
  time:date.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}),
  venue:row.venue_name||'Stade non renseigné',
  score:{home,away},actualResult:result,
  source:'supabase-archive',archived:true};
}
exports.handler=async(event)=>{
 if((event.httpMethod||'GET')!=='GET')return response(405,{error:'Méthode non autorisée'});
 let days=Number(event.queryStringParameters?.days||30);
 if(!Number.isFinite(days))days=30;
 days=Math.max(1,Math.min(365,Math.round(days)));
 const now=Date.now(),from=new Date(now-days*86400000).toISOString(),to=new Date(now).toISOString();
 try {
  const select='sportmonks_fixture_id,league_code,league_name,home_team_id,home_team_name,away_team_id,away_team_name,starting_at,venue_name,results!inner(home_score,away_score,result_1x2)';
  const matches=[];
  for(let offset=0;offset<10000;offset+=1000){
   const query='?select='+encodeURIComponent(select)+
      '&starting_at=gte.'+encodeURIComponent(from)+
      '&starting_at=lte.'+encodeURIComponent(to)+
      '&order=starting_at.desc&limit=1000&offset='+offset;
   const rows=await supabaseRequest('matches',{query});
   if(!Array.isArray(rows))throw new Error('Historique Supabase invalide');
   matches.push(...rows.map(row=>transform(row,now)).filter(Boolean));
   if(rows.length<1000)break;
   if(offset>=9000)throw new Error('Historique trop volumineux');
  }
  return response(200,{mode:'history',source:'supabase-archive',days,from:from.slice(0,10),to:to.slice(0,10),count:matches.length,matches});
 } catch(e) {
  console.error('MatchScope history: Supabase archive unavailable',e?.name||'error');
  return response(503,{error:'Historique Supabase momentanément indisponible',details:'Les résultats archivés sont conservés. Réessaye plus tard.'});
 }
};
exports._test={transform};
