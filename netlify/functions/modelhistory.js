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


const DAYS =
  365;


// =====================================================
// OUTILS
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
        side === 'home' &&
        Number.isFinite(
          goals
        )
      ) {

        result.home =
          goals;
      }


      if (
        side === 'away' &&
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


function response(
  statusCode,
  body
) {

  return {

    statusCode,


    headers: {

      'content-type':
        'application/json; charset=utf-8',

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
// FUNCTION
// =====================================================

exports.handler =
  async () => {


    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      return response(
        500,
        {

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

        DAYS *
        24 *
        60 *
        60 *
        1000
      );


    const endpoint =

      `${API}/fixtures/between/${iso(start)}/${iso(end)}`;


    try {


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

          return response(

            apiResponse.status,

            {

              error:
                'Erreur Sportmonks',

              details:
                raw.slice(
                  0,
                  1500
                )
            }
          );
        }


        const payload =
          JSON.parse(
            raw
          );


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


      const matches =

        fixtures

          .map(
            fixture => {


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


              const league =

                LEAGUES[
                  String(
                    fixture.league_id
                  )
                ];


              if (
                !league ||
                !kickoff
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


      return response(

        200,

        {

          mode:
            'model-history',

          days:
            DAYS,

          from:
            iso(
              start
            ),

          to:
            iso(
              end
            ),

          count:
            matches.length,

          matches
        }
      );


    } catch (
      error
    ) {


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
            )
        }
      );
    }
  };
