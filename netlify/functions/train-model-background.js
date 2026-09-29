const {
  supabaseRequest
} = require('./lib/supabase');


const {
  MODEL_VERSION,
  tuneModel,
  resetTuningCache
} = require('./lib/model-v07');


const HISTORY_DAYS = 365;
const PAGE_SIZE = 1000;

const MIN_HISTORY = 850;
const MIN_PER_LEAGUE = 180;


// =====================================================
// OUTILS
// =====================================================

function numberOrNull(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
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
      raw.replace(' ', 'T') + 'Z'
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


function transformHistoryRow(row) {

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
// CHARGEMENT HISTORIQUE SUPABASE
// =====================================================

async function loadHistory() {

  const end =
    new Date();

  const start =
    new Date(
      end.getTime()
      -
      HISTORY_DAYS *
      24 *
      60 *
      60 *
      1000
    );

  const rows = [];

  let offset = 0;


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
        end.toISOString()
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
          method: 'GET',
          query
        }
      );


    if (
      !Array.isArray(page)
    ) {

      throw new Error(
        'Réponse model_history invalide.'
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
        'Pagination historique trop longue.'
      );
    }
  }


  return rows
    .map(
      transformHistoryRow
    )
    .filter(Boolean)
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

function historyStatus(history) {

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
        ] !== undefined
      ) {

        leagues[
          match.competition
        ] += 1;
      }
    }
  );


  return {

    ready:

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
      MIN_PER_LEAGUE,

    count:
      history.length,

    leagues
  };
}


// =====================================================
// TRAITEMENT
// =====================================================

exports.handler =
  async event => {

    if (
      event.httpMethod !==
      'POST'
    ) {

      console.log(
        'train-model : POST uniquement.'
      );

      return;
    }


    let body = {};


    try {

      body =
        JSON.parse(
          event.body ||
          '{}'
        );

    } catch {

      console.error(
        'train-model : JSON invalide.'
      );

      return;
    }


    const expectedSecret =
      process
        .env
        .MATCHSCOPE_SYNC_SECRET;


    if (
      !expectedSecret ||
      body.secret !==
      expectedSecret
    ) {

      console.error(
        'train-model : accès non autorisé.'
      );

      return;
    }


    try {

      console.log(
        'MatchScope : démarrage calibration V0.7.'
      );


      // -----------------------------------------------
      // 1. HISTORIQUE
      // -----------------------------------------------

      const history =
        await loadHistory();


      const status =
        historyStatus(
          history
        );


      console.log(
        'Historique :',
        JSON.stringify(
          status
        )
      );


      if (
        !status.ready
      ) {

        throw new Error(
          'Historique MatchScope insuffisant.'
        );
      }


      // -----------------------------------------------
      // 2. NOUVEAU RÉGLAGE V0.7
      // -----------------------------------------------

      resetTuningCache();


      const tuning =
        tuneModel(
          history
        );


      if (
        !tuning?.config ||
        !tuning?.calibration
      ) {

        throw new Error(
          'Calibration V0.7 invalide.'
        );
      }


      // -----------------------------------------------
      // 3. SAUVEGARDE DU RUNTIME
      // -----------------------------------------------

      const row = {

        model_version:
          MODEL_VERSION,

        trained_at:
          new Date()
            .toISOString(),

        history_count:
          status.count,

        config:
          tuning.config,

        calibration:
          tuning.calibration,

        validation: {

          training:
            tuning.score
            ||
            null,

          holdout:
            tuning.holdout
            ||
            null,

          targetReached:
            Boolean(
              tuning.targetReached
            ),

          leagues:
            status.leagues
        },

        source:
          'supabase-model-history'
      };


      const saved =
        await supabaseRequest(
          'model_runtime',
          {

            method:
              'POST',

            query:
              '?on_conflict=model_version',

            body:
              row,

            prefer:
              'resolution=merge-duplicates,return=representation'
          }
        );


      console.log(
        'MatchScope V0.7 calibré.',
        JSON.stringify({
          modelVersion:
            MODEL_VERSION,

          historyCount:
            status.count,

          leagues:
            status.leagues,

          trainedAt:
            row.trained_at,

          saved:
            Array.isArray(saved)
              ? saved.length
              : Boolean(saved)
        })
      );


    } catch (
      error
    ) {

      console.error(
        'Erreur calibration MatchScope :',
        error?.message
        ||
        String(error)
      );
    }
  };
