const { analyzeFixture } = require('./lib/engine');

const API='https://api.sportmonks.com/v3/football';

exports.handler=async(event)=>{

  const token=
    process.env.SPORTMONKS_API_TOKEN;

  const id=
    event.queryStringParameters?.fixtureId;

  if(!token || !id){

    return {
      statusCode:400,
      body:JSON.stringify({
        error:
          'SPORTMONKS_API_TOKEN ou fixtureId manquant'
      })
    };
  }

  const url=
    new URL(
      `${API}/fixtures/${encodeURIComponent(id)}`
    );

  url.searchParams.set(
    'api_token',
    token
  );

  url.searchParams.set(
    'include',
    'league;participants;venue;metadata;predictions;lineups.player;expectedLineups;sidelined.sideline;formations;weatherReport;statistics.type;xGFixture;odds.bookmaker'
  );

  const res=
    await fetch(url);

  if(!res.ok){

    return {
      statusCode:res.status,
      body:JSON.stringify({
        error:'Sportmonks error'
      })
    };
  }

  const j=
    await res.json();

  return {
    statusCode:200,
    headers:{
      'content-type':'application/json',
      'cache-control':'public,max-age=60'
    },

    body:JSON.stringify({
      fixture:j.data,
      analysis:
        analyzeFixture(j.data)
    })
  };
};
