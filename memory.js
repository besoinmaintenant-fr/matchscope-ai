const {
  supabaseRequest
} = require('./supabase');


const LEAGUE_CODES = {
  8: 'PL',
  82: 'BL',
  564: 'LL',
  1251: 'SC',
  1101: 'CF1'
};


// =====================================================
// OUTILS
// =====================================================

function numberOrNull(value) {

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function probability(value) {

  const number =
    Number(value);


  if (
    !Number.isFinite(number)
  ) {

    return null;
  }


  const converted =
    number > 1
      ? number / 100
      : number;


  if (
    converted < 0 ||
    converted > 1
  ) {

    return null;
  }


  return converted;
}


function parseKickoff(value) {

  if (!value) {
    return null;
  }


  const raw =
    String(value).trim();


  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      .test(raw)
  ) {

    return new Date(
      raw.replace(
        ' ',
        'T'
      ) + 'Z'
    );
  }


  const date =
    new Date(raw);


  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


// =====================================================
// ÉQUIPES
// =====================================================

function getTeam(
  participants = [],
  location
) {

  return (
    participants.find(
      participant =>
        participant
          ?.meta
          ?.location === location
    )
    ||
    null
  );
}


// =====================================================
// COMPOSITIONS
//
// Sportmonks :
// type_id 11 = titulaire
// type_id 12 = remplaçant
// =====================================================

function lineupStatus(
  fixture
) {

  const lineups =
    Array.isArray(
      fixture?.lineups
    )
      ? fixture.lineups
      : [];


  const starters =
    lineups.filter(
      player =>
        Number(
          player?.type_id
        ) === 11
    );


  const teams =
    new Set(
      starters
        .map(
          player =>
            Number(
              player?.team_id
            )
        )
        .filter(
          Number.isFinite
        )
    );


  return {

    official:
      starters.length >= 22 &&
      teams.size >= 2,

    starters,

    all:
      lineups
  };
}


// =====================================================
// FORMATION
// =====================================================

function getFormation(
  fixture,
  teamId
) {

  const formations =
    Array.isArray(
      fixture?.formations
    )
      ? fixture.formations
      : [];


  const formation =
    formations.find(
      item =>

        Number(
          item?.participant_id
        ) ===
        Number(teamId)
    );


  return (
    formation?.formation
    ||
    formation?.formation_name
    ||
    null
  );
}


// =====================================================
// CONVERSION DES COMPOSITIONS POUR SUPABASE
// =====================================================

function buildLineupRows(
  fixture
) {

  const fixtureId =
    Number(
      fixture.id
    );


  const participants =
    Array.isArray(
      fixture?.participants
    )
      ? fixture.participants
      : [];


  const teamNames =
    new Map(

      participants.map(
        team => [
          Number(team.id),
          team.name
        ]
      )
    );


  const lineups =
    Array.isArray(
      fixture?.lineups
    )
      ? fixture.lineups
      : [];


  return lineups

    .map(
      item => {

        const teamId =
          numberOrNull(
            item?.team_id
          );


        const playerId =
          numberOrNull(
            item?.player_id
          )
          ??
          numberOrNull(
            item?.player?.id
          );


        if (
          teamId === null ||
          playerId === null
        ) {

          return null;
        }


        const starter =
          Number(
            item?.type_id
          ) === 11;


        return {

          sportmonks_fixture_id:
            fixtureId,

          team_id:
            teamId,

          team_name:
            teamNames.get(
              teamId
            )
            ||
            null,

          player_id:
            playerId,

          player_name:
            item?.player?.display_name
            ||
            item?.player?.name
            ||
            item?.player_name
            ||
            null,

          lineup_type:
            starter
              ? 'starter'
              : 'substitute',

          position:
            item
              ?.detailedposition
              ?.name
            ||
            item
              ?.position
              ?.name
            ||
            null,

          jersey_number:
            numberOrNull(
              item?.jersey_number
            ),

          formation:
            getFormation(
              fixture,
              teamId
            ),

          is_captain:
            Boolean(
              item?.captain
            ),

          raw_data:
            item
        };
      }
    )

    .filter(Boolean);
}


// =====================================================
// MATCH
// =====================================================

async function saveMatch(
  fixture,
  officialLineups
) {

  const participants =
    Array.isArray(
      fixture?.participants
    )
      ? fixture.participants
      : [];


  const home =
    getTeam(
      participants,
      'home'
    );


  const away =
    getTeam(
      participants,
      'away'
    );


  if (
    !home ||
    !away
  ) {

    throw new Error(
      'Équipes du match introuvables.'
    );
  }


  const kickoff =
    parseKickoff(
      fixture.starting_at
    );


  if (!kickoff) {

    throw new Error(
      'Date du match invalide.'
    );
  }


  const leagueId =
    numberOrNull(
      fixture.league_id
    );


  const row = {

    sportmonks_fixture_id:
      Number(
        fixture.id
      ),

    league_id:
      leagueId,

    league_code:
      LEAGUE_CODES[
        leagueId
      ]
      ||
      null,

    league_name:
      fixture?.league?.name
      ||
      null,

    season_id:
      numberOrNull(
        fixture.season_id
      ),

    starting_at:
      kickoff.toISOString(),

    status:
      fixture?.state?.name
      ||
      fixture?.state?.short_name
      ||
      null,

    home_team_id:
      numberOrNull(
        home.id
      ),

    home_team_name:
      home.name
      ||
      'Domicile',

    away_team_id:
      numberOrNull(
        away.id
      ),

    away_team_name:
      away.name
      ||
      'Extérieur',

    venue_id:
      numberOrNull(
        fixture?.venue?.id
      ),

    venue_name:
      fixture?.venue?.name
      ||
      null,

    lineups_confirmed:
      Boolean(
        officialLineups
      ),

    raw_data:
      fixture,

    updated_at:
      new Date()
        .toISOString()
  };


  return supabaseRequest(
    'matches',
    {

      method:
        'POST',

      query:
        '?on_conflict=sportmonks_fixture_id',

      body:
        row,

      prefer:
        'resolution=merge-duplicates,return=representation'
    }
  );
}


// =====================================================
// COMPOSITIONS
// =====================================================

async function saveLineups(
  fixture
) {

  const rows =
    buildLineupRows(
      fixture
    );


  if (
    !rows.length
  ) {

    return [];
  }


  return supabaseRequest(
    'lineups',
    {

      method:
        'POST',

      query:
        '?on_conflict=sportmonks_fixture_id,team_id,player_id',

      body:
        rows,

      prefer:
        'resolution=merge-duplicates,return=representation'
    }
  );
}


// =====================================================
// RECHERCHER UNE PRÉDICTION EXISTANTE
// =====================================================

async function findPrediction(
  fixtureId,
  modelVersion,
  stage
) {

  const query =

    `?sportmonks_fixture_id=eq.${encodeURIComponent(
      fixtureId
    )}`

    +

    `&model_version=eq.${encodeURIComponent(
      modelVersion
    )}`

    +

    `&prediction_stage=eq.${encodeURIComponent(
      stage
    )}`

    +

    '&select=*';


  const rows =
    await supabaseRequest(
      'predictions',
      {

        method:
          'GET',

        query
      }
    );


  return (
    Array.isArray(rows) &&
    rows.length
  )
    ? rows[0]
    : null;
}


// =====================================================
// ENREGISTRER UNE PRÉDICTION
// =====================================================

async function savePrediction({

  fixture,

  modelVersion = 'v0.7',

  stage,

  prediction,

  snapshot = {}

}) {

  if (
    !fixture?.id
  ) {

    throw new Error(
      'Fixture invalide.'
    );
  }


  if (
    ![
      'PRELINEUP',
      'FINAL'
    ].includes(stage)
  ) {

    throw new Error(
      'prediction_stage invalide.'
    );
  }


  const lineup =
    lineupStatus(
      fixture
    );


  // ---------------------------------
  // PRELINEUP
  // ---------------------------------

  if (
    stage === 'PRELINEUP' &&
    lineup.official
  ) {

    throw new Error(
      'Impossible de créer rétroactivement une PRELINEUP après publication des compositions.'
    );
  }


  // ---------------------------------
  // FINAL
  // ---------------------------------

  if (
    stage === 'FINAL' &&
    !lineup.official
  ) {

    throw new Error(
      'La prédiction FINAL nécessite les compositions officielles.'
    );
  }


  const fixtureId =
    Number(
      fixture.id
    );


  // ---------------------------------
  // IMMUTABILITÉ
  // ---------------------------------

  const existing =
    await findPrediction(

      fixtureId,

      modelVersion,

      stage
    );


  if (existing) {

    return {

      saved:
        false,

      alreadyExists:
        true,

      prediction:
        existing
    };
  }


  const home =
    probability(
      prediction?.home
    );


  const draw =
    probability(
      prediction?.draw
    );


  const away =
    probability(
      prediction?.away
    );


  if (
    home === null ||
    draw === null ||
    away === null
  ) {

    throw new Error(
      'Probabilités 1/N/2 invalides.'
    );
  }


  const total =
    home +
    draw +
    away;


  if (
    Math.abs(
      total - 1
    ) > 0.03
  ) {

    throw new Error(
      `Somme des probabilités incorrecte : ${total.toFixed(4)}`
    );
  }


  // ---------------------------------
  // SAUVEGARDE MATCH
  // ---------------------------------

  await saveMatch(

    fixture,

    lineup.official
  );


  // ---------------------------------
  // SAUVEGARDE XI SI DISPONIBLES
  // ---------------------------------

  if (
    lineup.official
  ) {

    await saveLineups(
      fixture
    );
  }


  // ---------------------------------
  // PRÉDICTION FIGÉE
  // ---------------------------------

  const row = {

    sportmonks_fixture_id:
      fixtureId,

    model_version:
      modelVersion,

    prediction_stage:
      stage,

    generated_at:
      new Date()
        .toISOString(),

    lineup_confirmed:
      lineup.official,

    probability_home:
      home,

    probability_draw:
      draw,

    probability_away:
      away,

    lambda_home:
      numberOrNull(
        prediction?.lambdaHome
      ),

    lambda_away:
      numberOrNull(
        prediction?.lambdaAway
      ),

    probability_over_15:
      probability(
        prediction?.over15
      ),

    probability_over_25:
      probability(
        prediction?.over25
      ),

    probability_btts:
      probability(
        prediction?.btts
      ),

    elo_home:
      numberOrNull(
        prediction?.eloHome
      ),

    elo_away:
      numberOrNull(
        prediction?.eloAway
      ),

    data_coverage:
      numberOrNull(
        prediction?.dataCoverage
        ??
        prediction?.quality
      ),

    snapshot: {

      ...snapshot,

      captured_at:
        new Date()
          .toISOString(),

      stage,

      official_lineups:
        lineup.official,

      starters_found:
        lineup.starters.length
    },

    locked:
      true
  };


  const saved =
    await supabaseRequest(
      'predictions',
      {

        method:
          'POST',

        body:
          row,

        prefer:
          'return=representation'
      }
    );


  return {

    saved:
      true,

    alreadyExists:
      false,

    prediction:
      Array.isArray(saved)
        ? saved[0]
        : saved
  };
}


// =====================================================
// EXPORTS SERVEUR UNIQUEMENT
// =====================================================

module.exports = {

  lineupStatus,

  saveMatch,

  saveLineups,

  findPrediction,

  savePrediction
};
