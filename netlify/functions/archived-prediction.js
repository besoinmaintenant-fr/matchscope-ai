'use strict';
const {supabaseRequest}=require('./lib/supabase');
const response=(statusCode,body)=>({statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(body)});
exports.handler=async event=>{
 if((event.httpMethod||'GET')!=='GET')return response(405,{error:'Méthode non autorisée'});
 const id=String(event.queryStringParameters?.fixtureId||'');
 if(!/^[1-9][0-9]{0,11}$/.test(id))return response(400,{error:'Match invalide'});
 try{
  const [matches,predictions,scorers]=await Promise.all([
   supabaseRequest('matches',{query:'?select=starting_at&sportmonks_fixture_id=eq.'+id+'&limit=1'}),
   supabaseRequest('predictions',{query:'?select=sportmonks_fixture_id,prediction_stage,model_version,generated_at,probability_home,probability_draw,probability_away,snapshot&sportmonks_fixture_id=eq.'+id+'&order=generated_at.desc&limit=20'}),
   supabaseRequest('scorer_predictions',{query:'?select=kickoff_at,captured_at,players&sportmonks_fixture_id=eq.'+id+'&limit=1'})
  ]);
  const kickoff=Date.parse(matches?.[0]?.starting_at||'');
  if(!Number.isFinite(kickoff))return response(404,{error:'Match absent des archives'});
  const scorerRow=Array.isArray(scorers)?scorers[0]:null;
  const scorerValid=scorerRow && Array.isArray(scorerRow.players) &&
    Number.isFinite(Date.parse(scorerRow.captured_at)) &&
    Date.parse(scorerRow.captured_at)<kickoff &&
    Date.parse(scorerRow.captured_at)<Date.parse(scorerRow.kickoff_at);
  const archivedScorers=scorerValid?scorerRow.players.filter(p=>
    typeof p?.name==='string' && p.name.length<200 &&
    p.probability!=null && Number.isFinite(Number(p.probability)) &&
    Number(p.probability)>=0 && Number(p.probability)<=100
   ).slice(0,20).map(p=>({name:p.name,probability:Number(p.probability),team:typeof p.team==='string'?p.team:''})):[];
  const filtered=(Array.isArray(predictions)?predictions:[])
   .filter(p=>['FINAL','PRELINEUP'].includes(p.prediction_stage))
   .filter(p=>Number.isFinite(Date.parse(p.generated_at))&&Date.parse(p.generated_at)<kickoff)
   .sort((a,b)=>(a.prediction_stage==='FINAL'?0:1)-(b.prediction_stage==='FINAL'?0:1)
      ||Date.parse(b.generated_at)-Date.parse(a.generated_at));
  const p=filtered[0];
  if(!p)return response(200,{found:false,fixtureId:id,scorers:archivedScorers,message:'Aucun pronostic 1/N/2 figé avant le coup d’envoi pour ce match.'});
  const valid=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n))?Number(n):null;
  const probs=[p.probability_home,p.probability_draw,p.probability_away].map(valid);
  if(probs.some(x=>x===null||x<0||x>1))return response(200,{found:false,fixtureId:id,scorers:archivedScorers,message:'Probabilités 1/N/2 archivées incomplètes.'});
  const score=p.snapshot?.exactScore?.mostLikelyScore;
  return response(200,{found:true,fixtureId:id,stage:p.prediction_stage,modelVersion:p.model_version,
   capturedAt:p.generated_at,archived:true,
   probabilities:{home:probs[0],draw:probs[1],away:probs[2]},
   exactScore:typeof score?.score==='string'?score.score:null,
   scorers:archivedScorers});
 }catch(e){
  console.error('MatchScope archived prediction unavailable',e?.name||'error');
  return response(503,{error:'Archives Supabase temporairement indisponibles'});
 }
};
