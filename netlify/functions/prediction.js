const {
  supabaseRequest
} = require('./lib/supabase');


const {
  savePrediction,
  findPrediction,
  lineupStatus
} = require('./lib/memory');


const {
  MODEL_VERSION,
  predictV07
} = require('./lib/model-v07');


const API =
  'https://api.sportmonks.com/v3/football';


const HISTORY_DAYS =
  365;


const PAGE_SIZE =
  1000;


/*
 * On ne permet pas au moteur serveur
 * de travailler sur une base historique
 * manifestement incomplète.
 */
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
// RÉPONSE
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


  /*
   * Format Sportmonks fréquent :
   * 2026-09-29 19:00:00
   */

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      .test(raw)
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
// SPORTMONKS : MATCH À ANALYSER
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


  /*
   * Pour l'instant les compositions
   * permettent surtout de déterminer
   * PRELINEUP / FINAL.
   *
   * Leur effet mathématique sera ajouté
   * séparément après validation.
   */

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
// CONVERSION DU MATCH CIBLE
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
// HISTORIQUE SUPABASE -> FORMAT V0.7
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
// CHARGER LES 365 JOURS AVANT LE MATCH
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

    /*
     * Protection anti-fuite temporelle :
     *
     * seules les rencontres antérieures
     * au coup d'envoi peuvent être utilisées.
     */

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


    /*
     * Sécurité contre une boucle anormale.
     */

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
// INTERDIRE UNE PRÉDICTION APRÈS LE COUP D'ENVOI
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
// FORMAT POUR MEMORY.JS
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
// HANDLER NETLIFY
// =====================================================

exports.handler =
  async event => {

    /*
     * POST uniquement.
     *
     * Le navigateur n'envoie jamais
     * les probabilités.
     *
     * Il envoie seulement fixtureId.
     */

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
      // 1. RÉCUPÉRER LE MATCH DEPUIS SPORTMONKS
      // =================================================

      const fixture =
        await fetchFixture(
          fixtureId,
          token
        );


      // =================================================
      // 2. CONSTRUIRE LA CIBLE V0.7
      // =================================================

      const target =
        buildTarget(
          fixture
        );


      /*
       * Anti-fuite :
       * jamais de nouvelle prédiction
       * après le début du match.
       */

      ensureBeforeKickoff(
        target
      );


      // =================================================
      // 3. STATUT DES COMPOSITIONS
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
      // 4. IMMUTABILITÉ
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

            prediction:
              existing
          }
        );
      }


      // =================================================
      // 5. HISTORIQUE MATCHSCOPE
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
              'La base MatchScope doit être initialisée avant les prédictions serveur.',

            history:
              historyInfo
          }
        );
      }


      // =================================================
      // 6. CALCUL V0.7 CÔTÉ SERVEUR
      // =================================================

      const output =
        predictV07(

          history,

          target
        );


      const model =
        output.model;


      // =================================================
      // 7. PRELINEUP
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
                'supabase-model-history',

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
                output.validation,

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

            history:
              historyInfo,

            model,

            validation:
              output.validation
          }
        );
      }


      // =================================================
      // 8. XI OFFICIELS
      // =================================================
      //
      // IMPORTANT :
      //
      // V0.7 n'utilise pas encore les compositions
      // dans ses mathématiques.
      //
      // On ne sauvegarde donc pas une fausse FINAL
      // identique à la PRELINEUP.
      //
      // Cela préservera la qualité scientifique
      // de notre future comparaison :
      //
      // Brier PRELINEUP vs Brier FINAL.
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

          reason:
            'FINAL_LINEUP_MODEL_PENDING',

          message:
            'Les compositions officielles sont disponibles. La base V0.7 a été calculée, mais aucune prédiction FINAL n’est enregistrée tant que l’effet des compositions n’est pas intégré et validé.',

          history:
            historyInfo,

          baseModel:
            model,

          validation:
            output.validation
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
