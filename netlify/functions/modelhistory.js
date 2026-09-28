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
 * Sportmonks autorise au maximum
 * 100 jours par requête.
 *
 * On utilise 99 jours pour rester
 * volontairement sous la limite.
 */

const CHUNK_DAYS =
  99;



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


  /*
   * Format Sportmonks classique :
   * 2026-09-28 15:30:00
   */

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
// CONSTRUCTION DES 4 PÉRIODES
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
        CHUNK_DAYS
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


    /*
     * Le prochain morceau commence
     * le lendemain pour éviter
     * les doublons.
     */

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

      /*
       * C'est la structure qui fonctionnait
       * déjà dans ton historique 90 jours.
       */

      if (
        item?.description !==
        'CURRENT'
      ) {

        return;
      }


      const participant =
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
        participant ===
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
        participant ===
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

function response(
  statusCode,
  body
) {

  return {

    statusCode,


    headers: {

      'content-type':
        'application/json; charset=utf-8',


      /*
       * Évite de recharger 365 jours
       * à chaque ouverture d'un match.
       */

      'cache-control':
        'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
    },


    body:
      JSON.stringify(
        body
      )
  };
}



// =====================================================
// RÉCUPÉRER UNE PÉRIODE SPORTMONKS
// =====================================================

async function fetchRange(
  token,
  range
) {

  const fixtures =
    [];


  const endpoint =

    `${API}/fixtures/between/${iso(range.start)}/${iso(range.end)}`;


  let page =
    1;


  let hasMore =
    true;


  while (
    hasMore &&
    page <= 20
  ) {

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
        `Sportmonks ${apiResponse.status} sur ${iso(range.start)} → ${iso(range.end)} : ${raw.slice(0, 800)}`
      );
    }


    let payload =
      {};


    try {

      payload =
        JSON.parse(
          raw
        );

    } catch (
      error
    ) {

      throw new Error(
        `Réponse Sportmonks invalide sur ${iso(range.start)} → ${iso(range.end)}`
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


  return fixtures;
}



// =====================================================
// TRANSFORMER FIXTURE
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


  /*
   * Match pas terminé ou score
   * indisponible :
   * on ne l'utilise pas au backtest.
   */

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
// FUNCTION NETLIFY
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

      return response(
        500,
        {

          error:
            'SPORTMONKS_API_TOKEN absent.'
        }
      );
    }


    /*
     * Date aujourd'hui.
     */

    const end =
      new Date();


    /*
     * 365 jours en arrière.
     */

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


    /*
     * Exemple :
     *
     * bloc 1 = 99 jours
     * bloc 2 = 99 jours
     * bloc 3 = 99 jours
     * bloc 4 = reste
     */

    const ranges =
      buildRanges(
        start,
        end
      );


    try {

      /*
       * Les 4 grandes périodes
       * sont téléchargées en parallèle.
       *
       * À l'intérieur de chaque période,
       * la pagination reste séquentielle.
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


      /*
       * Fusion des 4 périodes.
       */

      const rawFixtures =
        results.flat();


      /*
       * Protection anti doublon
       * via fixture.id.
       */

      const uniqueFixtures =
        new Map();


      rawFixtures.forEach(
        fixture => {

          if (
            fixture?.id ===
            undefined ||
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


      /*
       * Transformation vers
       * le format MatchScope.
       */

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

          /*
           * Ordre chronologique :
           * très important pour Elo
           * et le backtest.
           */

          .sort(
            (
              first,
              second
            ) =>

              first.kickoffTs -
              second.kickoffTs
          );


      /*
       * Informations de diagnostic.
       */

      const leagueCounts =
        {};


      matches.forEach(
        match => {

          leagueCounts[
            match.competition
          ] =

            (
              leagueCounts[
                match.competition
              ]

              ||

              0
            )

            +

            1;
        }
      );


      return response(
        200,
        {

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


          leagues:
            leagueCounts,


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


      return response(
        500,
        {

          error:
            'Erreur MatchScope model-history',


          details:

            error?.message

            ||

            String(
              error
            ),


          /*
           * Très pratique pour voir
           * si les 365 jours ont bien
           * été divisés.
           */

          requestedDays:
            TOTAL_DAYS,


          chunkDays:
            CHUNK_DAYS,


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
