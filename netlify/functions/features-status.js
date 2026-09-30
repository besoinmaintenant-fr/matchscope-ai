const {
  supabaseRequest
} = require('./lib/supabase');


// =====================================================
// MATCHSCOPE
// ÉTAT DU FEATURE ENGINE
// =====================================================

const FEATURE_VERSION =
  'features-v1';


const MODEL_LEAGUES = [
  'PL',
  'BL',
  'LL'
];


const PAGE_SIZE =
  1000;


// =====================================================
// OUTILS
// =====================================================

function array(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


function average(
  values
) {

  const clean =

    array(
      values
    )

      .map(
        value =>
          Number(
            value
          )
      )

      .filter(
        Number.isFinite
      );


  if (
    !clean.length
  ) {

    return null;
  }


  return (

    clean.reduce(
      (
        total,
        value
      ) =>
        total + value,
      0
    )

    /

    clean.length
  );
}


function round(
  value,
  decimals = 1
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {

    return null;
  }


  const factor =
    Math.pow(
      10,
      decimals
    );


  return (

    Math.round(
      number *
      factor
    )

    /

    factor
  );
}


// =====================================================
// MATCHS CIBLES
// =====================================================

async function loadTargets() {

  const rows =
    [];


  let offset =
    0;


  while (
    true
  ) {

    const query =

      '?select='

      +

      [
        'sportmonks_fixture_id',
        'league_code',
        'lineups_confirmed'
      ].join(',')

      +

      `&league_code=in.(${MODEL_LEAGUES.join(',')})`

      +

      '&order=starting_at.asc'

      +

      `&limit=${PAGE_SIZE}`

      +

      `&offset=${offset}`;


    const page =
      await supabaseRequest(
        'matches',
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
        'Réponse Supabase matches invalide.'
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
      20000
    ) {

      throw new Error(
        'Pagination matches anormalement longue.'
      );
    }
  }


  return rows;
}


// =====================================================
// FEATURES
// =====================================================

async function loadFeatures() {

  const rows =
    [];


  let offset =
    0;


  while (
    true
  ) {

    const query =

      '?select='

      +

      [
        'sportmonks_fixture_id',
        'feature_stage',
        'league_code',
        'data_coverage'
      ].join(',')

      +

      `&feature_version=eq.${encodeURIComponent(
        FEATURE_VERSION
      )}`

      +

      '&order=starting_at.asc'

      +

      `&limit=${PAGE_SIZE}`

      +

      `&offset=${offset}`;


    const page =
      await supabaseRequest(
        'match_features',
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
        'Réponse Supabase match_features invalide.'
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
      50000
    ) {

      throw new Error(
        'Pagination match_features anormalement longue.'
      );
    }
  }


  return rows;
}


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
// HANDLER
// =====================================================

exports.handler =
  async event => {

    if (
      event.httpMethod !==
      'GET'
    ) {

      return jsonResponse(
        405,
        {

          success:
            false,

          error:
            'GET requis.'
        }
      );
    }


    try {

      const [
        targets,
        features
      ] =
        await Promise.all([

          loadTargets(),

          loadFeatures()
        ]);


      // =================================================
      // MATCHS CIBLES
      // =================================================

      const targetIds =
        new Set(

          targets.map(
            row =>
              Number(
                row.sportmonks_fixture_id
              )
          )
        );


      const finalEligibleIds =
        new Set(

          targets

            .filter(
              row =>
                row.lineups_confirmed ===
                true
            )

            .map(
              row =>
                Number(
                  row.sportmonks_fixture_id
                )
            )
        );


      // =================================================
      // FEATURES VALIDES
      // =================================================

      const prelineup =
        features.filter(
          row =>

            row.feature_stage ===
            'PRELINEUP'

            &&

            targetIds.has(
              Number(
                row.sportmonks_fixture_id
              )
            )
        );


      const final =
        features.filter(
          row =>

            row.feature_stage ===
            'FINAL'

            &&

            finalEligibleIds.has(
              Number(
                row.sportmonks_fixture_id
              )
            )
        );


      // =================================================
      // COUVERTURE
      // =================================================

      const preCoverage =
        average(

          prelineup.map(
            row =>
              row.data_coverage
          )
        );


      const finalCoverage =
        average(

          final.map(
            row =>
              row.data_coverage
          )
        );


      // =================================================
      // PAR LIGUE
      // =================================================

      const leagues =
        {};


      MODEL_LEAGUES.forEach(
        league => {

          const leagueTargets =
            targets.filter(
              row =>
                row.league_code ===
                league
            );


          const leagueTargetIds =
            new Set(

              leagueTargets.map(
                row =>
                  Number(
                    row.sportmonks_fixture_id
                  )
              )
            );


          const leagueFinalEligible =
            leagueTargets.filter(
              row =>
                row.lineups_confirmed ===
                true
            );


          leagues[
            league
          ] = {

            targets:
              leagueTargets.length,

            finalEligible:
              leagueFinalEligible.length,

            prelineup:
              prelineup.filter(
                row =>
                  leagueTargetIds.has(
                    Number(
                      row.sportmonks_fixture_id
                    )
                  )
              ).length,

            final:
              final.filter(
                row =>
                  leagueTargetIds.has(
                    Number(
                      row.sportmonks_fixture_id
                    )
                  )
              ).length
          };
        }
      );


      // =================================================
      // PROGRESSION
      // =================================================

      const preTarget =
        targets.length;


      const finalTarget =
        finalEligibleIds.size;


      const preRemaining =
        Math.max(
          0,
          preTarget -
          prelineup.length
        );


      const finalRemaining =
        Math.max(
          0,
          finalTarget -
          final.length
        );


      const totalTarget =
        preTarget +
        finalTarget;


      const totalDone =
        prelineup.length +
        final.length;


      const progress =

        totalTarget

          ? Math.round(

              totalDone /
              totalTarget *
              1000

            ) / 10

          : 100;


      // =================================================
      // RÉPONSE
      // =================================================

      return jsonResponse(
        200,
        {

          success:
            true,

          featureVersion:
            FEATURE_VERSION,

          targets:
            preTarget,

          finalEligible:
            finalTarget,

          prelineup: {

            generated:
              prelineup.length,

            target:
              preTarget,

            remaining:
              preRemaining,

            averageCoverage:
              round(
                preCoverage
              )
          },

          final: {

            generated:
              final.length,

            target:
              finalTarget,

            remaining:
              finalRemaining,

            averageCoverage:
              round(
                finalCoverage
              )
          },

          total: {

            generated:
              totalDone,

            target:
              totalTarget,

            remaining:
              preRemaining +
              finalRemaining,

            progress
          },

          leagues,

          done:

            preRemaining ===
            0

            &&

            finalRemaining ===
            0
        }
      );


    } catch (
      error
    ) {

      console.error(
        'features-status:',
        error
      );


      return jsonResponse(
        500,
        {

          success:
            false,

          error:
            error?.message
            ||
            String(
              error
            )
        }
      );
    }
  };
