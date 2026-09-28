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

  '1251': {
    code: 'SC',
    name: 'Super Cup'
  },

  '8': {
    code: 'PL',
    name: 'Premier League'
  },

  '1101': {
    code: 'CF1',
    name: 'Club Friendlies 1'
  }
};


const LEAGUE_IDS =
  Object.keys(
    LEAGUES
  );


function iso(date) {

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
      ) + 'Z'
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
  homeGoals,
  awayGoals
) {

  if (
    homeGoals === null ||
    awayGoals === null
  ) {

    return null;
  }


  if (
    homeGoals >
    awayGoals
  ) {

    return '1';
  }


  if (
    awayGoals >
    homeGoals
  ) {

    return '2';
  }


  return 'N';
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
      JSON.stringify(
        body
      )
  };
}


exports.handler =
  async event => {


    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      return jsonResponse(
        500,
        {

          error:
            'SPORTMONKS_API_TOKEN absent.'
        }
      );
    }


    let days =
      Number(

        event
          ?.queryStringParameters
          ?.days

        ||

        30
      );


    if (
      !Number.isFinite(
        days
      )
    ) {

      days =
        30;
    }


    days =
      Math.max(

        1,

        Math.min(

          90,

          Math.round(
            days
          )
        )
      );


    const end =
      new Date();


    const start =
      new Date(

        Date.now()

        -

        days *
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

          'league;participants;venue;scores'
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


        const response =
          await fetch(
            url
          );


        const raw =
          await response.text();


        if (
          !response.ok
        ) {

          return jsonResponse(

            response.status,

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


              return {


                id:
                  String(
                    fixture.id
                  ),


                mode:
                  'history',


                competition:
                  league?.code ||
                  'OTHER',


                competitionName:

                  fixture
                    ?.league
                    ?.name

                  ||

                  league?.name

                  ||

                  'Compétition',


                home:
                  home?.name ||
                  'Domicile',


                away:
                  away?.name ||
                  'Extérieur',


                homeId:
                  home?.id ||
                  null,


                awayId:
                  away?.id ||
                  null,


                /*
                IMPORTANT POUR BACKTEST

                On garde maintenant
                l'heure exacte du match.

                Cela permet au modèle
                de n'utiliser QUE les matchs
                qui avaient déjà été joués
                avant le match testé.
                */

                startingAt:

                  kickoff

                    ? kickoff.toISOString()

                    : null,


                kickoffTs:

                  kickoff

                    ? kickoff.getTime()

                    : null,


                date:

                  kickoff

                    ? kickoff
                        .toLocaleDateString(
                          'fr-FR',
                          {

                            day:
                              '2-digit',

                            month:
                              'short',

                            year:
                              'numeric',

                            timeZone:
                              'Europe/Paris'
                          }
                        )

                    : '—',


                time:

                  kickoff

                    ? kickoff
                        .toLocaleTimeString(
                          'fr-FR',
                          {

                            hour:
                              '2-digit',

                            minute:
                              '2-digit',

                            timeZone:
                              'Europe/Paris'
                          }
                        )

                    : '—',


                venue:

                  fixture
                    ?.venue
                    ?.name

                  ||

                  'Stade non renseigné',


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
                  ),


                resultInfo:

                  fixture
                    ?.result_info

                  ||

                  null
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

              (
                second.kickoffTs ||
                0
              )

              -

              (
                first.kickoffTs ||
                0
              )
          );


      return jsonResponse(

        200,

        {

          mode:
            'history',

          days,

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


      return jsonResponse(

        500,

        {

          error:
            'Erreur MatchScope historique',

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
