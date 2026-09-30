const {
  supabaseRequest
} = require('./lib/supabase');


// =====================================================
// MATCHSCOPE — SNAPSHOT STATUS
//
// Cet endpoint ne renvoie PAS les raw_fixture complets.
// Il expose seulement un résumé permettant de vérifier
// la mémoire pré-match.
// =====================================================


const STAGES = [
  'D1',
  'H6',
  'H3',
  'H90',
  'FINAL'
];


const MAX_FIXTURES =
  30;


// =====================================================
// OUTILS
// =====================================================

function array(value) {

  return Array.isArray(value)
    ? value
    : [];
}


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


function parseDate(value) {

  if (!value) {
    return null;
  }


  const date =
    new Date(value);


  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


function getTeamName(
  rawFixture,
  location
) {

  const participants =
    array(
      rawFixture?.participants
    );


  const team =
    participants.find(
      participant =>
        participant
          ?.meta
          ?.location ===
        location
    );


  return (
    team?.name
    ||
    null
  );
}


function hasData(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return false;
  }


  if (
    Array.isArray(value)
  ) {

    return value.length > 0;
  }


  if (
    typeof value === 'object'
  ) {

    return Object.keys(value).length > 0;
  }


  return true;
}


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
      JSON.stringify(body)
  };
}


// =====================================================
// CHARGEMENT
// =====================================================

async function loadSnapshots() {

  const rows =
    await supabaseRequest(
      'prematch_snapshots',
      {

        method:
          'GET',

        query:
          '?select='
          +
          [
            'sportmonks_fixture_id',
            'league_code',
            'snapshot_stage',
            'captured_at',
            'kickoff_at',
            'minutes_to_kickoff',
            'lineups_official',
            'starters_found',
            'data_coverage',
            'home_team_id',
            'away_team_id',
            'venue',
            'weather_report',
            'formations',
            'sidelined',
            'lineups',
            'statistics',
            'odds',
            'optional_status',
            'raw_fixture'
          ].join(',')
          +
          '&order=kickoff_at.desc,captured_at.asc'
          +
          '&limit=150'
      }
    );


  return array(rows);
}


// =====================================================
// GROUPEMENT PAR MATCH
// =====================================================

function buildFixtures(
  rows
) {

  const grouped =
    new Map();


  for (
    const row
    of rows
  ) {

    const fixtureId =
      String(
        row.sportmonks_fixture_id
      );


    if (
      !grouped.has(
        fixtureId
      )
    ) {

      const homeName =
        getTeamName(
          row.raw_fixture,
          'home'
        );


      const awayName =
        getTeamName(
          row.raw_fixture,
          'away'
        );


      grouped.set(
        fixtureId,
        {

          fixtureId,

          league:
            row.league_code
            ||
            '—',

          kickoff:
            row.kickoff_at,

          home:
            homeName
            ||
            `Équipe ${row.home_team_id ?? '?'}`,

          away:
            awayName
            ||
            `Équipe ${row.away_team_id ?? '?'}`,

          stages:
            {}
        }
      );
    }


    const fixture =
      grouped.get(
        fixtureId
      );


    /*
     * Si un snapshot plus récent contient enfin
     * les noms d'équipes, on les récupère.
     */
    const homeName =
      getTeamName(
        row.raw_fixture,
        'home'
      );


    const awayName =
      getTeamName(
        row.raw_fixture,
        'away'
      );


    if (homeName) {
      fixture.home =
        homeName;
    }


    if (awayName) {
      fixture.away =
        awayName;
    }


    const stage =
      row.snapshot_stage;


    fixture.stages[
      stage
    ] = {

      stage,

      capturedAt:
        row.captured_at,

      minutesToKickoff:
        numberOrNull(
          row.minutes_to_kickoff
        ),

      lineupsOfficial:
        row.lineups_official ===
        true,

      startersFound:
        numberOrNull(
          row.starters_found
        )
        ??
        0,

      coverage:
        numberOrNull(
          row.data_coverage
        ),

      available: {

        venue:
          hasData(
            row.venue
          ),

        weather:
          hasData(
            row.weather_report
          ),

        formations:
          hasData(
            row.formations
          ),

        sidelined:
          hasData(
            row.sidelined
          ),

        lineups:
          hasData(
            row.lineups
          ),

        statistics:
          hasData(
            row.statistics
          ),

        odds:
          hasData(
            row.odds
          )
      },

      oddsStatus:
        row
          ?.optional_status
          ?.odds
        ??
        null
    };
  }


  return Array
    .from(
      grouped.values()
    )

    .sort(
      (
        first,
        second
      ) => {

        const a =
          parseDate(
            first.kickoff
          )
          ?.getTime()
          ??
          0;


        const b =
          parseDate(
            second.kickoff
          )
          ?.getTime()
          ??
          0;


        return b - a;
      }
    )

    .slice(
      0,
      MAX_FIXTURES
    )

    .map(
      fixture => {

        const capturedStages =
          STAGES.filter(
            stage =>
              Boolean(
                fixture.stages[
                  stage
                ]
              )
          );


        return {

          ...fixture,

          capturedStages,

          capturedCount:
            capturedStages.length,

          complete:
            STAGES.every(
              stage =>
                Boolean(
                  fixture.stages[
                    stage
                  ]
                )
            ),

          hasFinal:
            Boolean(
              fixture.stages
                .FINAL
            )
        };
      }
    );
}


// =====================================================
// SYNTHÈSE
// =====================================================

function buildSummary(
  fixtures
) {

  const stages =
    {};


  STAGES.forEach(
    stage => {

      stages[
        stage
      ] =
        fixtures.filter(
          fixture =>
            Boolean(
              fixture
                .stages[
                  stage
                ]
            )
        ).length;
    }
  );


  return {

    fixtures:
      fixtures.length,

    completeFixtures:
      fixtures.filter(
        fixture =>
          fixture.complete
      ).length,

    withFinal:
      fixtures.filter(
        fixture =>
          fixture.hasFinal
      ).length,

    stages
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

      const rows =
        await loadSnapshots();


      const fixtures =
        buildFixtures(
          rows
        );


      return jsonResponse(
        200,
        {

          success:
            true,

          checkedAt:
            new Date()
              .toISOString(),

          expectedStages:
            STAGES,

          summary:
            buildSummary(
              fixtures
            ),

          fixtures
        }
      );


    } catch (error) {

      console.error(
        'snapshot-status:',
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
            String(error)
        }
      );
    }
  };
