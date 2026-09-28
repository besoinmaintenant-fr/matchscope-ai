const API =
  'https://api.sportmonks.com/v3/football';


const LEAGUES = {

  '82': {
    code: 'BL',
    name: 'Bundesliga'
  },

  '564': {
    code: 'LL',
    name: 'La Liga'
  },

  '8': {
    code: 'PL',
    name: 'Premier League'
  }
};


const LEAGUE_IDS =
  Object.keys(
    LEAGUES
  );


const TOTAL_DAYS =
  365;


/*
 * Sportmonks limite la requête "between"
 * à 100 jours maximum.
 *
 * On utilise donc 90 jours par bloc,
 * volontairement sous la limite.
 */

const CHUNK_DAYS =
  90;


const ENGINE_VERSION =
  'modelhistory-v2';


// =====================================================
// OUTILS DATE
// =====================================================

function iso(
  date
) {

  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


function addDays(
  date,
  days
) {

  const copy =
    new Date(
      date
    );


  copy.setUTCDate(
    copy.getUTCDate() +
    days
  );


  return copy;
}


function parseKickoff(
  value
) {

  if (
    !value
  ) {

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
// DÉCOUPAGE 365 JOURS
// =====================================================

function buildRanges(
  start,
  end
) {

  const ranges =
    [];


  let cursor =
    new Date(
      start
    );


  while (
    cursor <= end
  ) {

    let rangeEnd =
      addDays(
        cursor,
        CHUNK_DAYS - 1
      );


    if (
      rangeEnd >
      end
    ) {

      rangeEnd =
        new Date(
          end
        );
    }


    ranges.push({

      start:
        new Date(
          cursor
        ),

      end:
        new Date(
          rangeEnd
        )
    });


    cursor =
      addDays(
        rangeEnd,
        1
      );
  }


  return ranges;
}


// =====================================================
// ÉQUIPES
// =====================================================

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
// SCORE FINAL
// =====================================================

function getFinalScore(
  scores = []
) {

  const result = {

    home:
      null,

    away:
      null
  };


  scores.forEach(
    item => {

      if (
        item?.description !==
        'CURRENT'
      ) {

        return;
      }


      const side =
        item
          ?.score
          ?.participant;


      const goals =
        Number(
          item
            ?.score
            ?.goals
        );


      if (
        side ===
        'home'

        &&

        Number.isFinite(
          goals
        )
      ) {

        result.home =
          goals;
      }


      if (
        side ===
        'away'

        &&

        Number.isFinite(
          goals
        )
      ) {

        result.away =
          goals;
      }
    }
  );


  return result;
}


function getResult(
  home,
  away
) {

  if (
    home === null ||
    away === null
  ) {

    return null;
  }


  if (
    home >
    away
  ) {

    return '1';
  }


  if (
    away >
    home
  ) {

    return '2';
  }


  return 'N';
}


// =====================================================
// RÉPONSE NETLIFY
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


      /*
       * Important :
       * on coupe complètement le cache
       * pendant nos tests V0.7.
       */

      'cache-control':
        'no-store, no-cache, must-revalidate, max-age=0',


      pragma:
        'no-cache',


      expires:
        '0'
    },


    body:
      JSON.stringify(
        body
      )
  };
}


// =====================================================
// RÉCUPÉRATION D'UN BLOC SPORTMONKS
// =====================================================

async function fetchRange(
  token,
  range
) {

  const fixtures =
    [];


  let page =
    1;


  let hasMore =
    true;


  while (
    hasMore &&
    page <= 30
  ) {

    const endpoint =

      `${API}/fixtures/between/${iso(range.start)}/${iso(range.end)}`;


    const url =
      new URL(
        endpoint
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

      'league;participants;scores'
    );


    url.searchParams.set(
      'per_page',
      '50'
    );


    url.searchParams.set(
      'page',
      String(
        page
      )
    );


    const apiResponse =
      await fetch(
        url
      );


    const raw =
      await apiResponse.text();


    if (
      !apiResponse.ok
    ) {

      throw new Error(

        `Sportmonks ${apiResponse.status} sur ${iso(range.start)} -> ${iso(range.end)} : ${raw.slice(0, 1000)}`
      );
    }


    let payload;


    try {

      payload =
        JSON.parse(
          raw
        );

    } catch (
      error
    ) {

      throw new Error(

        `Réponse Sportmonks invalide sur ${iso(range.start)} -> ${iso(range.end)}`
      );
    }


    if (
      Array.isArray(
        payload.data
      )
    ) {

      fixtures.push(
        ...payload.data
      );
    }


    hasMore =
      Boolean(

        payload
          ?.pagination
          ?.has_more
      );


    page +=
      1;
  }


  if (
    hasMore
  ) {

    throw new Error(

      `Pagination incomplète sur ${iso(range.start)} -> ${iso(range.end)} après 30 pages.`
    );
  }


  return fixtures;
}


// =====================================================
// TRANSFORMATION FIXTURE
// =====================================================

function transformFixture(
  fixture
) {

  const participants =

    Array.isArray(
      fixture.participants
    )

      ? fixture.participants

      : [];


  const home =

    getTeam(
      participants,
      'home'
    )

    ||

    participants[0]

    ||

    {};


  const away =

    getTeam(
      participants,
      'away'
    )

    ||

    participants[1]

    ||

    {};


  const score =

    getFinalScore(

      Array.isArray(
        fixture.scores
      )

        ? fixture.scores

        : []
    );


  if (
    score.home === null ||
    score.away === null
  ) {

    return null;
  }


  const kickoff =
    parseKickoff(
      fixture.starting_at
    );


  if (
    !kickoff
  ) {

    return null;
  }


  const league =

    LEAGUES[
      String(
        fixture.league_id
      )
    ];


  if (
    !league
  ) {

    return null;
  }


  return {

    id:
      String(
        fixture.id
      ),


    competition:
      league.code,


    competitionName:

      fixture
        ?.league
        ?.name

      ||

      league.name,


    home:

      home?.name

      ||

      'Domicile',


    away:

      away?.name

      ||

      'Extérieur',


    homeId:

      home?.id

      ||

      null,


    awayId:

      away?.id

      ||

      null,


    startingAt:
      kickoff.toISOString(),


    kickoffTs:
      kickoff.getTime(),


    score: {

      home:
        score.home,

      away:
        score.away
    },


    actualResult:

      getResult(
        score.home,
        score.away
      )
  };
}


// =====================================================
// NETLIFY FUNCTION
// =====================================================

exports.handler =
  async () => {


    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (
      !token
    ) {

      return jsonResponse(
        500,
        {

          engineVersion:
            ENGINE_VERSION,


          error:
            'SPORTMONKS_API_TOKEN absent.'
        }
      );
    }


    const end =
      new Date();


    const start =
      new Date(

        Date.now()

        -

        TOTAL_DAYS *
        24 *
        60 *
        60 *
        1000
      );


    const ranges =
      buildRanges(
        start,
        end
      );


    try {

      /*
       * Chaque bloc fait maximum 90 jours.
       *
       * Ils sont récupérés séparément,
       * donc Sportmonks ne reçoit jamais
       * une requête de 365 jours.
       */

      const results =
        await Promise.all(

          ranges.map(
            range =>

              fetchRange(
                token,
                range
              )
          )
        );


      const rawFixtures =
        results.flat();


      /*
       * Suppression des doublons.
       */

      const uniqueFixtures =
        new Map();


      rawFixtures.forEach(
        fixture => {

          if (
            fixture?.id ===
            undefined

            ||

            fixture?.id ===
            null
          ) {

            return;
          }


          uniqueFixtures.set(

            String(
              fixture.id
            ),

            fixture
          );
        }
      );


      const matches =

        Array.from(
          uniqueFixtures.values()
        )

          .map(
            transformFixture
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


      const leagues =
        {};


      matches.forEach(
        match => {

          leagues[
            match.competition
          ] =

            (
              leagues[
                match.competition
              ]

              ||

              0
            )

            +

            1;
        }
      );


      return jsonResponse(
        200,
        {

          engineVersion:
            ENGINE_VERSION,


          mode:
            'model-history',


          days:
            TOTAL_DAYS,


          chunkDays:
            CHUNK_DAYS,


          chunks:
            ranges.length,


          from:
            iso(
              start
            ),


          to:
            iso(
              end
            ),


          rawCount:
            rawFixtures.length,


          count:
            matches.length,


          leagues,


          ranges:

            ranges.map(
              range => ({

                from:
                  iso(
                    range.start
                  ),

                to:
                  iso(
                    range.end
                  )
              })
            ),


          matches
        }
      );


    } catch (
      error
    ) {


      console.error(
        'MatchScope modelhistory:',
        error
      );


      return jsonResponse(
        500,
        {

          engineVersion:
            ENGINE_VERSION,


          error:
            'Erreur MatchScope model-history',


          details:

            error?.message

            ||

            String(
              error
            ),


          requestedDays:
            TOTAL_DAYS,


          chunkDays:
            CHUNK_DAYS,


          chunks:
            ranges.length,


          ranges:

            ranges.map(
              range => ({

                from:
                  iso(
                    range.start
                  ),

                to:
                  iso(
                    range.end
                  )
              })
            )
        }
      );
    }
  };
