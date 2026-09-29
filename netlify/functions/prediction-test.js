const {
  handler: predictionHandler
} = require('./prediction');


const API =
  'https://api.sportmonks.com/v3/football';


const LEAGUES =
  '8,82,564';


function iso(date) {

  return date
    .toISOString()
    .slice(0, 10);
}


function jsonResponse(
  statusCode,
  body
) {

  return {
    statusCode,

    headers: {
      'Content-Type':
        'application/json; charset=utf-8',

      'Cache-Control':
        'no-store'
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}


exports.handler =
  async () => {

    const token =
      process.env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      return jsonResponse(
        500,
        {
          success: false,
          error:
            'SPORTMONKS_API_TOKEN absent.'
        }
      );
    }


    try {

      /*
       * On cherche volontairement
       * un match à plus de 24 h.
       *
       * Cela augmente les chances
       * d'être en PRELINEUP.
       */

      const start =
        new Date(
          Date.now()
          +
          24 * 60 * 60 * 1000
        );


      const end =
        new Date(
          Date.now()
          +
          21 * 24 * 60 * 60 * 1000
        );


      const url =
        new URL(
          `${API}/fixtures/between/${iso(start)}/${iso(end)}`
        );


      url.searchParams.set(
        'api_token',
        token
      );


      url.searchParams.set(
        'filters',
        `fixtureLeagues:${LEAGUES}`
      );


      url.searchParams.set(
        'include',
        'league;participants'
      );


      url.searchParams.set(
        'per_page',
        '50'
      );


      const response =
        await fetch(url);


      const raw =
        await response.text();


      if (!response.ok) {

        return jsonResponse(
          500,
          {
            success: false,

            error:
              'Erreur Sportmonks.',

            details:
              raw.slice(
                0,
                1000
              )
          }
        );
      }


      const payload =
        JSON.parse(raw);


      const fixtures =
        Array.isArray(
          payload?.data
        )
          ? payload.data
          : [];


      if (!fixtures.length) {

        return jsonResponse(
          404,
          {
            success: false,
            error:
              'Aucun match futur trouvé pour le test.'
          }
        );
      }


      fixtures.sort(
        (a, b) =>

          new Date(
            String(a.starting_at)
              .replace(
                ' ',
                'T'
              )
              +
              'Z'
          ).getTime()

          -

          new Date(
            String(b.starting_at)
              .replace(
                ' ',
                'T'
              )
              +
              'Z'
          ).getTime()
      );


      const fixture =
        fixtures[0];


      const participants =
        Array.isArray(
          fixture?.participants
        )
          ? fixture.participants
          : [];


      const home =
        participants.find(
          team =>
            team?.meta?.location ===
            'home'
        );


      const away =
        participants.find(
          team =>
            team?.meta?.location ===
            'away'
        );


      /*
       * Appel DIRECT de notre vraie
       * Function prediction.js
       */

      const predictionResponse =
        await predictionHandler({

          httpMethod:
            'POST',

          body:
            JSON.stringify({
              fixtureId:
                Number(
                  fixture.id
                )
            })
        });


      let predictionData;


      try {

        predictionData =
          JSON.parse(
            predictionResponse.body
          );

      } catch {

        predictionData = {
          raw:
            predictionResponse.body
        };
      }


      return jsonResponse(
        200,
        {
          success:
            true,

          selectedFixture: {

            fixtureId:
              fixture.id,

            league:
              fixture?.league?.name
              ||
              fixture.league_id,

            startingAt:
              fixture.starting_at,

            home:
              home?.name
              ||
              null,

            away:
              away?.name
              ||
              null
          },

          predictionHttpStatus:
            predictionResponse.statusCode,

          prediction:
            predictionData
        }
      );


    } catch (error) {

      return jsonResponse(
        500,
        {
          success: false,

          error:
            'Erreur prediction-test.',

          details:
            error?.message
            ||
            String(error)
        }
      );
    }
  };
