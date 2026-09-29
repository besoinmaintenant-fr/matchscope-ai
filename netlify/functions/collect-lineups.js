const {
  saveMatch,
  saveLineups,
  lineupStatus
} = require('./lib/memory');


const API =
  'https://api.sportmonks.com/v3/football';


const LEAGUE_IDS = [
  8,   // Premier League
  82,  // Bundesliga
  564  // La Liga
];


const LOOKAHEAD_MINUTES =
  180;


// =====================================================
// OUTILS DATE
// =====================================================

function isoDate(
  date
) {

  return date
    .toISOString()
    .slice(
      0,
      10
    );
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


// =====================================================
// RÉCUPÉRATION SPORTMONKS
// =====================================================

async function fetchFixtures(
  token
) {

  const now =
    new Date();


  const tomorrow =
    new Date(
      now.getTime()
      +
      24 *
      60 *
      60 *
      1000
    );


  const url =
    new URL(

      `${API}/fixtures/between/${isoDate(
        now
      )}/${isoDate(
        tomorrow
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

    [
      'league',
      'participants',
      'venue',
      'state',
      'lineups.player',
      'formations'
    ].join(';')
  );


  url.searchParams.set(
    'per_page',
    '100'
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


  return Array.isArray(
    payload?.data
  )
    ? payload.data
    : [];
}


// =====================================================
// MATCHS À SURVEILLER
// =====================================================

function isUpcomingCandidate(
  fixture
) {

  const kickoff =
    parseKickoff(
      fixture?.starting_at
    );


  if (!kickoff) {

    return false;
  }


  const now =
    Date.now();


  const difference =
    kickoff.getTime()
    -
    now;


  if (
    difference <= 0
  ) {

    return false;
  }


  const maxDifference =

    LOOKAHEAD_MINUTES

    *

    60

    *

    1000;


  return (
    difference <=
    maxDifference
  );
}


// =====================================================
// TRAITEMENT
// =====================================================

async function processFixture(
  fixture
) {

  const lineup =
    lineupStatus(
      fixture
    );


  if (
    !lineup.official
  ) {

    return {

      fixtureId:
        fixture.id,

      saved:
        false,

      reason:
        'LINEUPS_NOT_OFFICIAL',

      starters:
        lineup.starters.length
    };
  }


  await saveMatch(
    fixture,
    true
  );


  const savedLineups =
    await saveLineups(
      fixture
    );


  return {

    fixtureId:
      fixture.id,

    saved:
      true,

    starters:
      lineup.starters.length,

    lineupRows:
      Array.isArray(
        savedLineups
      )
        ? savedLineups.length
        : null
  };
}


// =====================================================
// NETLIFY SCHEDULED FUNCTION
// =====================================================

exports.handler =
  async () => {

    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      console.error(
        'collect-lineups : SPORTMONKS_API_TOKEN absent.'
      );

      return;
    }


    try {

      const fixtures =
        await fetchFixtures(
          token
        );


      const candidates =
        fixtures.filter(
          isUpcomingCandidate
        );


      const results =
        [];


      for (
        const fixture
        of candidates
      ) {

        try {

          const result =
            await processFixture(
              fixture
            );


          results.push(
            result
          );


        } catch (
          error
        ) {

          results.push({

            fixtureId:
              fixture?.id
              ||
              null,

            saved:
              false,

            error:
              error?.message
              ||
              String(error)
          });
        }
      }


      console.log(

        JSON.stringify(
          {

            function:
              'collect-lineups',

            checkedAt:
              new Date()
                .toISOString(),

            fixturesReceived:
              fixtures.length,

            candidates:
              candidates.length,

            results
          },
          null,
          2
        )
      );


    } catch (
      error
    ) {

      console.error(

        'collect-lineups :',

        error?.message
        ||
        error
      );
    }
  };
