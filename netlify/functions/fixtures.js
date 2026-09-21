const { analyzeFixture } = require('./lib/engine');

const API='https://api.sportmonks.com/v3/football';
const token=process.env.SPORTMONKS_API_TOKEN;
const leagueIds=(process.env.SPORTMONKS_LEAGUE_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);

function iso(d){return d.toISOString().slice(0,10)}
function loc(participants,where){ return participants?.find(p=>p?.meta?.location===where) || null; }

exports.handler=async()=>{
  if(!token || !leagueIds.length) return {statusCode:204,body:''};

  const start=new Date();
  const end=new Date(Date.now()+7*86400000);

  const url=new URL(`${API}/fixtures/between/${iso(start)}/${iso(end)}`);

  url.searchParams.set('api_token',token);
  url.searchParams.set('filters',`fixtureLeagues:${leagueIds.join(',')}`);
  url.searchParams.set(
    'include',
    'league;participants;venue;metadata;predictions;lineups;expectedLineups;sidelined;formations;weatherReport;xGFixture'
  );
  url.searchParams.set('per_page','50');

  const res=await fetch(url);

  if(!res.ok){
    return {
      statusCode:res.status,
      body:JSON.stringify({error:'Sportmonks error'})
    };
  }

  const json=await res.json();

  const matches=(json.data||[]).map(f=>{
    const a=analyzeFixture(f);

    const home=
      loc(f.participants,'home') ||
      f.participants?.[0] ||
      {};

    const away=
      loc(f.participants,'away') ||
      f.participants?.[1] ||
      {};

    const date=new Date(
      (f.starting_at||'').replace(' ','T')+'Z'
    );

    const lineups=f.lineups||[];

    const starters=(teamId)=>
      lineups
        .filter(
          p =>
            Number(p.type_id)===11 &&
            p.team_id===teamId
        )
        .map(p=>p.player_name);

    const forms=f.formations||[];

    const form=(teamId)=>
      forms.find(
        x =>
          x.participant_id===teamId ||
          x.team_id===teamId
      )?.formation || '—';

    const m=a.markets;

    return {
      id:String(f.id),

      competition:String(f.league_id),

      competitionName:
        f.league?.name ||
        'Compétition',

      date:
        date.toLocaleDateString(
          'fr-FR',
          {
            day:'2-digit',
            month:'short'
          }
        ),

      time:
        date.toLocaleTimeString(
          'fr-FR',
          {
            hour:'2-digit',
            minute:'2-digit'
          }
        ),

      home:
        home.name ||
        'Domicile',

      away:
        away.name ||
        'Extérieur',

      venue:
        f.venue?.name ||
        'Stade à confirmer',

      surface:
        f.venue?.surface ||
        'À confirmer',

      weather:
        f.weatherreport?.description ||
        f.weatherReport?.description ||
        'À confirmer',

      official:a.official,

      quality:a.quality,

      confidence:a.confidence,

      probs:{
        home:a.probs.home*100,
        draw:a.probs.draw*100,
        away:a.probs.away*100
      },

      formationHome:form(home.id),

      formationAway:form(away.id),

      homeXI:
        starters(home.id).length
          ? starters(home.id)
          : ['XI probable — en attente'],

      awayXI:
        starters(away.id).length
          ? starters(away.id)
          : ['XI probable — en attente'],

      absences:
        (f.sidelined||[]).length
          ? `${f.sidelined.length} absence(s) / suspension(s) signalée(s) par le fournisseur.`
          : 'Aucune absence structurée remontée ou donnée indisponible.',

      factors:[
        [
          'Qualité des données',
          `Couverture consolidée : ${a.quality}%.`,
          a.quality>=85 ? '+8' : '+3',
          a.quality>=85 ? 'pos' : 'mid'
        ],

        [
          'Compositions',
          a.official
            ? 'XI officiels détectés.'
            : 'XI officiels non encore détectés.',
          a.official ? '+7' : '−5',
          a.official ? 'pos' : 'neg'
        ],

        [
          'Prédiction fournisseur',
          'Probabilités de base normalisées puis contrôlées par le moteur.',
          'Actif',
          'mid'
        ],

        [
          'Absences',
          `${(f.sidelined||[]).length} événement(s) sidelined remonté(s).`,
          (f.sidelined||[]).length
            ? 'À vérifier'
            : 'Neutre',
          'mid'
        ]
      ],

      markets:[
        [
          '1X2 — domicile',
          `${Math.round(a.probs.home*100)}%`,
          'modèle'
        ],
        [
          '1X',
          `${Math.round(m.doubleHome*100)}%`,
          'modèle'
        ],
        [
          'X2',
          `${Math.round(m.doubleAway*100)}%`,
          'modèle'
        ],
        [
          '+1,5 buts',
          `${Math.round(m.over15*100)}%`,
          'estimation'
        ],
        [
          '+2,5 buts',
          `${Math.round(m.over25*100)}%`,
          'estimation'
        ],
        [
          'BTTS — Oui',
          `${Math.round(m.btts*100)}%`,
          'estimation'
        ]
      ],

      sources:[
        [
          'Sportmonks Football API',
          'Fixture, participants, lineups, absences, xG, prédictions, stade et météo lorsqu’ils sont couverts.',
          'Principal'
        ]
      ]
    };
  });

  return {
    statusCode:200,
    headers:{
      'content-type':'application/json',
      'cache-control':'public,max-age=60'
    },
    body:JSON.stringify({matches})
  };
};
