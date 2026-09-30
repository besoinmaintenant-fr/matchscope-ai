const {
  supabaseRequest
} = require('./lib/supabase');


const API =
  'https://api.sportmonks.com/v3/football';


const LEAGUE_IDS = [
  8,    // Premier League
  82,   // Bundesliga
  564   // La Liga
];


const LEAGUE_CODES = {
  8: 'PL',
  82: 'BL',
  564: 'LL'
};


const STAGES = [
  'D1',
  'H6',
  'H3',
  'H90',
  'FINAL'
];


const STAGE_WINDOWS = {

  D1: {
    targetMinutes: 1440,
    minMinutes: 1380,
    maxMinutes: 1500
  },

  H6: {
    targetMinutes: 360,
    minMinutes: 330,
    maxMinutes: 390
  },

  H3: {
    targetMinutes: 180,
    minMinutes: 150,
    maxMinutes: 210
  },

  H90: {
    targetMinutes: 90,
    minMinutes: 75,
    maxMinutes: 105
  }
};


const MAX_FIXTURES =
  30;


const MAX_UPCOMING =
  12;


const UPCOMING_DAYS =
  14;


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


function isoDate(date) {

  return date
    .toISOString()
    .slice(
      0,
      10
    );
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


  return team?.name || null;
}


function getTeam(
  fixture,
  location
) {

  return array(
    fixture?.participants
  )

    .find(
      participant =>
        participant
          ?.meta
          ?.location ===
        location
    )

    ||

    null;
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
// MÉMOIRE SUPABASE
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
// GROUPEMENT SNAPSHOTS
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
// PROCHAINS MATCHS SPORTMONKS
// =====================================================

async function fetchUpcomingFixtures(
  token
) {

  if (!token) {

    throw new Error(
      'SPORTMONKS_API_TOKEN absent.'
    );
  }


  const now =
    new Date();


  const end =
    new Date(
      now.getTime()
      +
      UPCOMING_DAYS *
      24 *
      60 *
      60 *
      1000
    );


  const fixtures =
    [];


  let page =
    1;


  let hasMore =
    true;


  while (
    hasMore &&
    page <= 5
  ) {

    const url =
      new URL(

        `${API}/fixtures/between/${isoDate(
          now
        )}/${isoDate(
          end
        )}`
      );


    url.searchParams.set(
      'api_token',
      token
    );


    url.searchParams.set(
      'filters',
      `fixtureLeagues:${LEAGUE_IDS.join(',')}`
    );


    url.searchParams.set(
      'include',
      'league;participants;state'
    );


    url.searchParams.set(
      'per_page',
      '100'
    );


    url.searchParams.set(
      'page',
      String(page)
    );


    const response =
      await fetch(url);


    const raw =
      await response.text();


    let payload =
      {};


    try {

      payload =
        JSON.parse(raw);

    } catch {

      throw new Error(
        'Réponse Sportmonks upcoming illisible.'
      );
    }


    if (!response.ok) {

      throw new Error(
        payload?.message
        ||
        payload?.error
        ||
        `Sportmonks ${response.status}`
      );
    }


    fixtures.push(
      ...array(
        payload?.data
      )
    );


    hasMore =
      Boolean(
        payload
          ?.pagination
          ?.has_more
      );


    page += 1;
  }


  const nowTimestamp =
    Date.now();


  return fixtures

    .map(
      fixture => {

        const kickoff =
          parseDate(
            fixture?.starting_at
          );


        if (!kickoff) {
          return null;
        }


        if (
          kickoff.getTime() <=
          nowTimestamp
        ) {

          return null;
        }


        const home =
          getTeam(
            fixture,
            'home'
          );


        const away =
          getTeam(
            fixture,
            'away'
          );


        return {

          fixtureId:
            String(
              fixture.id
            ),

          league:
            LEAGUE_CODES[
              Number(
                fixture.league_id
              )
            ]
            ||
            fixture?.league?.name
            ||
            '—',

          kickoff:
            kickoff.toISOString(),

          home:
            home?.name
            ||
            'Domicile',

          away:
            away?.name
            ||
            'Extérieur'
        };
      }
    )

    .filter(Boolean)

    .sort(
      (
        first,
        second
      ) =>

        new Date(
          first.kickoff
        ).getTime()

        -

        new Date(
          second.kickoff
        ).getTime()
    )

    .slice(
      0,
      MAX_UPCOMING
    );
}


// =====================================================
// PLAN DE CAPTURE
// =====================================================

function buildStagePlan(
  fixture,
  capturedStages
) {

  const kickoff =
    parseDate(
      fixture.kickoff
    );


  if (!kickoff) {
    return [];
  }


  const kickoffTimestamp =
    kickoff.getTime();


  const now =
    Date.now();


  const stages =
    [];


  for (
    const stage
    of [
      'D1',
      'H6',
      'H3',
      'H90'
    ]
  ) {

    const window =
      STAGE_WINDOWS[
        stage
      ];


    const captured =
      capturedStages?.[
        stage
      ]
      ||
      null;


    const windowStart =
      kickoffTimestamp
      -
      window.maxMinutes *
      60000;


    const windowEnd =
      kickoffTimestamp
      -
      window.minMinutes *
      60000;


    const targetAt =
      kickoffTimestamp
      -
      window.targetMinutes *
      60000;


    let status;


    if (captured) {

      status =
        'CAPTURED';

    } else if (
      now <
      windowStart
    ) {

      status =
        'WAITING';

    } else if (
      now <=
      windowEnd
    ) {

      status =
        'DUE_NOW';

    } else {

      status =
        'MISSED';
    }


    stages.push({

      stage,

      status,

      captured:
        Boolean(
          captured
        ),

      capturedAt:
        captured?.capturedAt
        ||
        null,

      targetAt:
        new Date(
          targetAt
        ).toISOString(),

      windowStart:
        new Date(
          windowStart
        ).toISOString(),

      windowEnd:
        new Date(
          windowEnd
        ).toISOString(),

      minutesUntilWindow:

        status ===
        'WAITING'

          ? Math.ceil(
              (
                windowStart -
                now
              )
              /
              60000
            )

          : 0
    });
  }


  const finalCaptured =
    capturedStages
      ?.FINAL
    ||
    null;


  stages.push({

    stage:
      'FINAL',

    status:

      finalCaptured

        ? 'CAPTURED'

        : now <
          kickoffTimestamp

          ? 'WAITING_XI'

          : 'MISSED',

    captured:
      Boolean(
        finalCaptured
      ),

    capturedAt:
      finalCaptured
        ?.capturedAt
      ||
      null,

    targetAt:
      null,

    windowStart:
      null,

    windowEnd:
      null,

    minutesUntilWindow:
      null
  });


  return stages;
}


// =====================================================
// PROCHAINS MATCHS + MÉMOIRE
// =====================================================

function attachCapturePlan(
  upcoming,
  memoryFixtures
) {

  const memoryById =
    new Map(

      memoryFixtures.map(
        fixture => [

          String(
            fixture.fixtureId
          ),

          fixture
        ]
      )
    );


  return upcoming.map(
    fixture => {

      const memory =
        memoryById.get(
          String(
            fixture.fixtureId
          )
        );


      const plan =
        buildStagePlan(

          fixture,

          memory?.stages
          ||
          {}
        );


      const nextDue =
        plan.find(
          item =>
            item.status ===
            'DUE_NOW'
        )

        ||

        plan.find(
          item =>
            item.status ===
            'WAITING'
        )

        ||

        plan.find(
          item =>
            item.status ===
            'WAITING_XI'
        )

        ||

        null;


      return {

        ...fixture,

        capturedCount:
          plan.filter(
            item =>
              item.captured
          ).length,

        plan,

        nextDue
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


      let upcoming =
        [];


      let upcomingError =
        null;


      try {

        const futureFixtures =
          await fetchUpcomingFixtures(
            process
              .env
              .SPORTMONKS_API_TOKEN
          );


        upcoming =
          attachCapturePlan(
            futureFixtures,
            fixtures
          );

      } catch (error) {

        upcomingError =
          error?.message
          ||
          String(error);
      }


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

          upcomingSummary: {

            count:
              upcoming.length,

            dueNow:
              upcoming.filter(
                fixture =>
                  fixture.plan.some(
                    stage =>
                      stage.status ===
                      'DUE_NOW'
                  )
              ).length,

            waitingFinal:
              upcoming.filter(
                fixture =>
                  fixture.plan.some(
                    stage =>
                      stage.status ===
                      'WAITING_XI'
                  )
              ).length
          },

          upcomingError,

          upcoming,

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
