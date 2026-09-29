const {
  supabaseRequest
} = require('./lib/supabase');


const {
  savePrediction,
  findPrediction,
  lineupStatus,
  saveMatch,
  saveLineups
} = require('./lib/memory');


const {
  MODEL_VERSION,
  buildModel
} = require('./lib/model-v07');


const API =
  'https://api.sportmonks.com/v3/football';


const HISTORY_DAYS =
  365;


const PAGE_SIZE =
  1000;


const MIN_HISTORY =
  850;


const MIN_PER_LEAGUE =
  180;


const LEAGUES = {

  8: {
    code: 'PL',
    name: 'Premier League'
  },

  82: {
    code: 'BL',
    name: 'Bundesliga'
  },

  564: {
    code: 'LL',
    name: 'La Liga'
  }
};


// =====================================================
// RÉPONSE JSON
// =====================================================

function jsonResponse(
  statusCode,
  body
) {

  return {

    statusCode,

    headers: {

      'content-type':
        'application/json; charset=utf-8',

      'cache-control':
        'no-store'
    },

    body:
      JSON.stringify(
        body
      )
  };
}


// =====================================================
// OUTILS
// =====================================================

function numberOrNull(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function parseKickoff(
  value
) {

  if (!value) {

    return null;
  }


  const raw =
    String(
      value
    )
      .trim();


  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      .test(
        raw
      )
  ) {

    return new Date(

      raw.replace(
        ' ',
        'T'
      )

      +

      'Z'
    );
  }


  const date =
    new Date(
      raw
    );


  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


function normalizeTeam(
  value = ''
) {

  return String(
    value
  )

    .normalize(
      'NFD'
    )

    .replace(
      /[\u0300-\u036f]/g,
      ''
    )

    .toLowerCase()

    .replace(
      /[^a-z0-9]/g,
      ''
    );
}


function teamKey(
  competition,
  team
) {

  return `${competition}::${normalizeTeam(
    team
  )}`;
}


function getTeam(
  participants,
  location
) {

  return (

    participants.find(
      participant =>

        participant
          ?.meta
          ?.location ===
        location
    )

    ||

    null
  );
}


// =====================================================
// MATCH SPORTMONKS
// =====================================================

async function fetchFixture(
  fixtureId,
  token
) {

  const url =
    new URL(

      `${API}/fixtures/${encodeURIComponent(
        fixtureId
      )}`
    );


  url.searchParams.set(
    'api_token',
    token
  );


  url.searchParams.set(

    'include',

    [
      'league',
      'participants',
      'venue',
      'lineups.player',
      'formations'
    ].join(';')
  );


  const response =
    await fetch(
      url
    );


  const raw =
    await response.text();


  let payload;


  try {

    payload =
      JSON.parse(
        raw
      );

  } catch {

    throw new Error(
      'Réponse Sportmonks invalide.'
    );
  }


  if (
    !response.ok
  ) {

    throw new Error(

      payload?.message

      ||

      payload?.error

      ||

      `Sportmonks ${response.status}`
    );
  }


  if (
    !payload?.data
  ) {

    throw new Error(
      'Match Sportmonks introuvable.'
    );
  }


  return payload.data;
}


// =====================================================
// MATCH CIBLE
// =====================================================

function buildTarget(
  fixture
) {

  const leagueId =
    Number(
      fixture?.league_id
    );


  const league =
    LEAGUES[
      leagueId
    ];


  if (!league) {

    throw new Error(
      'Ce championnat n’est pas pris en charge par V0.7.'
    );
  }


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
      'Équipes domicile/extérieur introuvables.'
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


  return {

    id:
      String(
        fixture.id
      ),

    competition:
      league.code,

    competitionName:
      fixture?.league?.name
      ||
      league.name,

    home:
      home.name
      ||
      'Domicile',

    away:
      away.name
      ||
      'Extérieur',

    homeId:
      numberOrNull(
        home.id
      ),

    awayId:
      numberOrNull(
        away.id
      ),

    startingAt:
      kickoff.toISOString(),

    kickoffTs:
      kickoff.getTime()
  };
}


// =====================================================
// HISTORIQUE SUPABASE
// =====================================================

function transformHistoryRow(
  row
) {

  const kickoff =
    parseKickoff(
      row.starting_at
    );


  const homeScore =
    numberOrNull(
      row.home_score
    );


  const awayScore =
    numberOrNull(
      row.away_score
    );


  if (
    !kickoff ||
    homeScore === null ||
    awayScore === null
  ) {

    return null;
  }


  if (
    ![
      'PL',
      'BL',
      'LL'
    ].includes(
      row.league_code
    )
  ) {

    return null;
  }


  if (
    ![
      '1',
      'N',
      '2'
    ].includes(
      row.result_1x2
    )
  ) {

    return null;
  }


  return {

    id:
      String(
        row.sportmonks_fixture_id
      ),

    competition:
      row.league_code,

    competitionName:
      row.league_name
      ||
      row.league_code,

    home:
      row.home_team_name,

    away:
      row.away_team_name,

    homeId:
      numberOrNull(
        row.home_team_id
      ),

    awayId:
      numberOrNull(
        row.away_team_id
      ),

    startingAt:
      kickoff.toISOString(),

    kickoffTs:
      kickoff.getTime(),

    score: {

      home:
        homeScore,

      away:
        awayScore
    },

    actualResult:
      row.result_1x2
  };
}


// =====================================================
// CHARGEMENT HISTORIQUE
// =====================================================

async function loadHistory(
  target
) {

  const kickoff =
    new Date(
      target.startingAt
    );


  const start =
    new Date(

      kickoff.getTime()

      -

      HISTORY_DAYS *
      24 *
      60 *
      60 *
      1000
    );


  const rows =
    [];


  let offset =
    0;


  while (true) {

    const query =

      '?select='

      +

      [
        'sportmonks_fixture_id',
        'league_code',
        'league_name',
        'home_team_id',
        'home_team_name',
        'away_team_id',
        'away_team_name',
        'starting_at',
        'home_score',
        'away_score',
        'result_1x2'
      ].join(',')

      +

      `&starting_at=gte.${encodeURIComponent(
        start.toISOString()
      )}`

      +

      `&starting_at=lt.${encodeURIComponent(
        kickoff.toISOString()
      )}`

      +

      '&order=starting_at.asc'

      +

      `&limit=${PAGE_SIZE}`

      +

      `&offset=${offset}`;


    const page =
      await supabaseRequest(
        'model_history',
        {

          method:
            'GET',

          query
        }
      );


    if (
      !Array.isArray(
        page
      )
    ) {

      throw new Error(
        'Réponse Supabase model_history invalide.'
      );
    }


    rows.push(
      ...page
    );


    if (
      page.length <
      PAGE_SIZE
    ) {

      break;
    }


    offset +=
      PAGE_SIZE;


    if (
      offset >
      10000
    ) {

      throw new Error(
        'Pagination historique anormalement longue.'
      );
    }
  }


  return rows

    .map(
      transformHistoryRow
    )

    .filter(
      Boolean
    )

    .sort(
      (
        first,
        second
      ) =>

        first.kickoffTs -
        second.kickoffTs
    );
}


// =====================================================
// CONTRÔLE HISTORIQUE
// =====================================================

function historyStatus(
  history
) {

  const leagues = {

    PL: 0,
    BL: 0,
    LL: 0
  };


  history.forEach(
    match => {

      if (
        leagues[
          match.competition
        ] !==
        undefined
      ) {

        leagues[
          match.competition
        ] +=
          1;
      }
    }
  );


  const ready =

    history.length >=
    MIN_HISTORY

    &&

    leagues.PL >=
    MIN_PER_LEAGUE

    &&

    leagues.BL >=
    MIN_PER_LEAGUE

    &&

    leagues.LL >=
    MIN_PER_LEAGUE;


  return {

    ready,

    count:
      history.length,

    leagues
  };
}


// =====================================================
// CHARGEMENT DU RÉGLAGE V0.7
// =====================================================

async function loadRuntime() {

  const query =

    `?model_version=eq.${encodeURIComponent(
      MODEL_VERSION
    )}`

    +

    '&select=*'

    +

    '&limit=1';


  const rows =
    await supabaseRequest(
      'model_runtime',
      {

        method:
          'GET',

        query
      }
    );


  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {

    throw new Error(
      'V0.7 n’est pas encore calibré dans model_runtime.'
    );
  }


  const runtime =
    rows[0];


  if (
    !runtime?.config ||
    !runtime?.calibration
  ) {

    throw new Error(
      'Réglage V0.7 incomplet dans model_runtime.'
    );
  }


  return runtime;
}


// =====================================================
// RECONSTRUCTION ELO
//
// Même logique que V0.7,
// mais sans refaire le tuning.
// =====================================================

function buildEloTimeline(
  history,
  config
) {

  const ratings =
    new Map();


  const preMatch =
    new Map();


  const chronological =

    [...history]

      .filter(
        match =>
          [
            'PL',
            'BL',
            'LL'
          ].includes(
            match.competition
          )
      )

      .filter(
        match =>
          Number.isFinite(
            Number(
              match.kickoffTs
            )
          )
      )

      .sort(
        (
          first,
          second
        ) =>

          Number(
            first.kickoffTs
          )

          -

          Number(
            second.kickoffTs
          )
      );


  const getRating =
    key =>

      ratings.has(
        key
      )

        ? ratings.get(
            key
          )

        : 1500;


  chronological.forEach(
    match => {

      const homeKey =
        teamKey(
          match.competition,
          match.home
        );


      const awayKey =
        teamKey(
          match.competition,
          match.away
        );


      const homeRating =
        getRating(
          homeKey
        );


      const awayRating =
        getRating(
          awayKey
        );


      preMatch.set(
        String(
          match.id
        ),
        {

          homeRating,

          awayRating
        }
      );


      const expectedHome =

        1

        /

        (
          1

          +

          Math.pow(

            10,

            -(
              homeRating
              +
              Number(
                config.eloHomeAdv
              )
              -
              awayRating
            )

            /

            400
          )
        );


      const homeGoals =
        numberOrNull(
          match?.score?.home
        );


      const awayGoals =
        numberOrNull(
          match?.score?.away
        );


      if (
        homeGoals === null ||
        awayGoals === null
      ) {

        return;
      }


      const actualHome =

        homeGoals >
        awayGoals

          ? 1

          : homeGoals ===
            awayGoals

            ? 0.5

            : 0;


      const goalDifference =
        Math.abs(
          homeGoals -
          awayGoals
        );


      const marginMultiplier =

        goalDifference <= 1

          ? 1

          : Math.sqrt(
              goalDifference
            );


      const delta =

        Number(
          config.eloK
        )

        *

        marginMultiplier

        *

        (
          actualHome -
          expectedHome
        );


      ratings.set(

        homeKey,

        homeRating +
        delta
      );


      ratings.set(

        awayKey,

        awayRating -
        delta
      );
    }
  );


  return {

    ratings,

    preMatch
  };
}


// =====================================================
// INTERDICTION APRÈS COUP D'ENVOI
// =====================================================

function ensureBeforeKickoff(
  target
) {

  const kickoff =
    Number(
      target.kickoffTs
    );


  if (
    !Number.isFinite(
      kickoff
    )
  ) {

    throw new Error(
      'Coup d’envoi invalide.'
    );
  }


  if (
    Date.now() >=
    kickoff
  ) {

    throw new Error(
      'Impossible de créer une prédiction après le coup d’envoi.'
    );
  }
}


// =====================================================
// FORMAT MEMORY.JS
// =====================================================

function predictionPayload(
  model
) {

  return {

    home:
      model.home,

    draw:
      model.draw,

    away:
      model.away,

    lambdaHome:
      model.lambdaHome,

    lambdaAway:
      model.lambdaAway,

    over15:
      model.over15,

    over25:
      model.over25,

    btts:
      model.btts,

    eloHome:
      model.eloHome,

    eloAway:
      model.eloAway,

    dataCoverage:
      model.quality
  };
}


// =====================================================
// HANDLER
// =====================================================

exports.handler =
  async event => {

    if (
      event.httpMethod !==
      'POST'
    ) {

      return jsonResponse(
        405,
        {

          success:
            false,

          error:
            'Méthode non autorisée.'
        }
      );
    }


    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      return jsonResponse(
        500,
        {

          success:
            false,

          error:
            'SPORTMONKS_API_TOKEN absent.'
        }
      );
    }


    let body =
      {};


    try {

      body =
        JSON.parse(
          event.body ||
          '{}'
        );

    } catch {

      return jsonResponse(
        400,
        {

          success:
            false,

          error:
            'JSON invalide.'
        }
      );
    }


    const fixtureId =
      Number(
        body.fixtureId
      );


    if (
      !Number.isFinite(
        fixtureId
      ) ||
      fixtureId <= 0
    ) {

      return jsonResponse(
        400,
        {

          success:
            false,

          error:
            'fixtureId invalide.'
        }
      );
    }


    try {

      // =================================================
      // 1. MATCH SPORTMONKS
      // =================================================

      const fixture =
        await fetchFixture(
          fixtureId,
          token
        );


      // =================================================
      // 2. MATCH CIBLE
      // =================================================

      const target =
        buildTarget(
          fixture
        );


      ensureBeforeKickoff(
        target
      );


      // =================================================
      // 3. COMPOSITIONS
      // =================================================

      const lineup =
        lineupStatus(
          fixture
        );


      const stage =

        lineup.official

          ? 'FINAL'

          : 'PRELINEUP';


      // =================================================
      // 4. MÉMORISATION IMMÉDIATE DES XI OFFICIELS
      // =================================================
      //
      // Dès que Sportmonks fournit au moins
      // 22 titulaires appartenant aux deux équipes,
      // on stocke le match et les compositions
      // dans Supabase.
      //
      // Cela NE modifie PAS encore V0.7.
      // Cela NE crée PAS encore une prédiction FINAL.
      // =================================================

      if (
        lineup.official
      ) {

        await saveMatch(
          fixture,
          true
        );


        await saveLineups(
          fixture
        );
      }


      // =================================================
      // 5. PRÉDICTION DÉJÀ FIGÉE ?
      // =================================================

      const existing =
        await findPrediction(

          fixtureId,

          MODEL_VERSION,

          stage
        );


      if (
        existing
      ) {

        return jsonResponse(
          200,
          {

            success:
              true,

            saved:
              false,

            alreadyExists:
              true,

            fixtureId,

            modelVersion:
              MODEL_VERSION,

            stage,

            officialLineups:
              lineup.official,

            startersFound:
              lineup.starters.length,

            lineupsStored:
              lineup.official,

            prediction:
              existing
          }
        );
      }


      // =================================================
      // 6. RUNTIME V0.7
      //
      // ICI ON NE RETUNE PLUS LE MODÈLE.
      // =================================================

      const runtime =
        await loadRuntime();


      // =================================================
      // 7. HISTORIQUE ACTUEL
      // =================================================

      const history =
        await loadHistory(
          target
        );


      const historyInfo =
        historyStatus(
          history
        );


      if (
        !historyInfo.ready
      ) {

        return jsonResponse(
          503,
          {

            success:
              false,

            error:
              'HISTORIQUE_MATCHSCOPE_INCOMPLET',

            message:
              'La mémoire MatchScope est insuffisante pour V0.7.',

            history:
              historyInfo
          }
        );
      }


      // =================================================
      // 8. ELO AVEC LES PARAMÈTRES FIGÉS
      // =================================================

      const eloState =
        buildEloTimeline(

          history,

          runtime.config
        );


      // =================================================
      // 9. CALCUL RAPIDE DU MATCH
      //
      // Plus de tuneModel()
      // Plus de backtest à chaque clic.
      // =================================================

      const model =
        buildModel(

          history,

          target,

          Infinity,

          runtime.config,

          eloState,

          runtime.calibration
        );


      // =================================================
      // 10. PRELINEUP
      // =================================================

      if (
        stage ===
        'PRELINEUP'
      ) {

        const saved =
          await savePrediction({

            fixture,

            modelVersion:
              MODEL_VERSION,

            stage:
              'PRELINEUP',

            prediction:
              predictionPayload(
                model
              ),

            snapshot: {

              engine:
                'MatchScope V0.7',

              source:
                'supabase-model-runtime',

              runtimeTrainedAt:
                runtime.trained_at
                ||
                null,

              runtimeHistoryCount:
                runtime.history_count
                ||
                null,

              historyDays:
                HISTORY_DAYS,

              historicalMatches:
                historyInfo.count,

              leagues:
                historyInfo.leagues,

              sample:
                model.sample,

              baseline:
                model.baseline,

              validation:
                runtime.validation
                ||
                null,

              lineupEffectApplied:
                false
            }
          });


        return jsonResponse(
          200,
          {

            success:
              true,

            saved:
              saved.saved,

            alreadyExists:
              saved.alreadyExists,

            fixtureId,

            modelVersion:
              MODEL_VERSION,

            stage:
              'PRELINEUP',

            officialLineups:
              false,

            startersFound:
              lineup.starters.length,

            lineupsStored:
              false,

            runtime: {

              trainedAt:
                runtime.trained_at
                ||
                null,

              historyCount:
                runtime.history_count
                ||
                null
            },

            history:
              historyInfo,

            model,

            validation:
              runtime.validation
              ||
              null
          }
        );
      }


      // =================================================
      // 11. XI OFFICIELS
      //
      // Les compositions sont désormais stockées.
      //
      // Mais on ne crée toujours PAS de fausse FINAL :
      // V0.7 ne sait pas encore mesurer
      // l'impact réel des titulaires.
      // =================================================

      return jsonResponse(
        200,
        {

          success:
            true,

          saved:
            false,

          alreadyExists:
            false,

          fixtureId,

          modelVersion:
            MODEL_VERSION,

          stage:
            'FINAL',

          officialLineups:
            true,

          startersFound:
            lineup.starters.length,

          lineupsStored:
            true,

          reason:
            'FINAL_LINEUP_MODEL_PENDING',

          message:
            'Les compositions officielles sont enregistrées dans la mémoire MatchScope. La base V0.7 est calculée avec le runtime figé, mais aucune prédiction FINAL n’est enregistrée tant que l’effet des compositions n’a pas été validé.',

          runtime: {

            trainedAt:
              runtime.trained_at
              ||
              null,

            historyCount:
              runtime.history_count
              ||
              null
          },

          history:
            historyInfo,

          baseModel:
            model,

          validation:
            runtime.validation
            ||
            null
        }
      );


    } catch (
      error
    ) {

      console.error(
        'MatchScope prediction:',
        error
      );


      return jsonResponse(
        500,
        {

          success:
            false,

          error:
            'Erreur prediction.',

          details:
            error?.message
            ||
            String(error)
        }
      );
    }
  };
