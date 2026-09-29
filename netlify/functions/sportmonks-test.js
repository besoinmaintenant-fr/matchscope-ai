const API =
  'https://api.sportmonks.com/v3/football';


function iso(date) {
  return date
    .toISOString()
    .slice(0, 10);
}


exports.handler = async () => {

  const token =
    process.env.SPORTMONKS_API_TOKEN;


  if (!token) {

    return {
      statusCode: 500,

      headers: {
        'Content-Type':
          'application/json; charset=utf-8'
      },

      body: JSON.stringify({
        success: false,
        error: 'SPORTMONKS_API_TOKEN absent.'
      })
    };
  }


  try {

    const yesterday =
      new Date();


    yesterday.setUTCDate(
      yesterday.getUTCDate() - 1
    );


    const date =
      iso(yesterday);


    const url =
      new URL(
        `${API}/fixtures/between/${date}/${date}`
      );


    url.searchParams.set(
      'api_token',
      token
    );


    url.searchParams.set(
      'filters',
      'fixtureLeagues:8,82,564'
    );


    url.searchParams.set(
      'per_page',
      '5'
    );


    const response =
      await fetch(url);


    const text =
      await response.text();


    let data;


    try {
      data =
        JSON.parse(text);
    } catch {
      data =
        text;
    }


    if (!response.ok) {

      return {
        statusCode: 500,

        headers: {
          'Content-Type':
            'application/json; charset=utf-8'
        },

        body: JSON.stringify(
          {
            success: false,
            message:
              'CONNEXION SPORTMONKS ÉCHEC',

            status:
              response.status,

            error:
              data
          },
          null,
          2
        )
      };
    }


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
            'CONNEXION SPORTMONKS OK',

          date,

          fixtures:
            Array.isArray(
              data?.data
            )
              ? data.data.length
              : null
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
          'application/json; charset=utf-8'
      },

      body: JSON.stringify(
        {
          success: false,

          message:
            'CONNEXION SPORTMONKS ÉCHEC',

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
