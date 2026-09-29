const {
  supabaseRequest
} = require('./lib/supabase');


exports.handler = async (event) => {

  if (
    event.httpMethod !== 'GET'
  ) {

    return {
      statusCode: 405,

      headers: {
        'Content-Type':
          'application/json; charset=utf-8'
      },

      body: JSON.stringify({
        success: false,
        error: 'Méthode non autorisée'
      })
    };
  }


  try {

    const data =
      await supabaseRequest(
        'matches',
        {
          method: 'GET',

          query:
            '?select=sportmonks_fixture_id&limit=1'
        }
      );


    return {
      statusCode: 200,

      headers: {
        'Content-Type':
          'application/json; charset=utf-8',

        'Cache-Control':
          'no-store'
      },

      body: JSON.stringify(
        {
          success: true,

          message:
            'CONNEXION SUPABASE OK',

          rows:
            Array.isArray(data)
              ? data.length
              : null,

          data
        },
        null,
        2
      )
    };


  } catch (error) {

    return {
      statusCode: 500,

      headers: {
        'Content-Type':
          'application/json; charset=utf-8',

        'Cache-Control':
          'no-store'
      },

      body: JSON.stringify(
        {
          success: false,

          message:
            'CONNEXION SUPABASE ÉCHEC',

          error:
            error?.message
            ||
            String(error)
        },
        null,
        2
      )
    };
  }
};
