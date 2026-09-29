exports.handler = async (event) => {

  // Quand tu ouvres la page dans Safari
  if (event.httpMethod === 'GET') {

    return {
      statusCode: 200,

      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      },

      body: `
        <!DOCTYPE html>

        <html lang="fr">

        <head>

          <meta charset="UTF-8">

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          >

          <title>MatchScope Test POST</title>

          <style>

            body {
              background: #050806;
              color: white;
              font-family: -apple-system, sans-serif;
              padding: 30px;
            }

            h1 {
              color: #00e86b;
            }

            button {
              width: 100%;
              padding: 18px;
              margin-top: 30px;
              background: #00e86b;
              color: #001b0b;
              border: 0;
              border-radius: 12px;
              font-size: 17px;
              font-weight: bold;
            }

          </style>

        </head>

        <body>

          <h1>MatchScope</h1>

          <p>
            Test de la passerelle POST vers Netlify.
          </p>

          <form
            method="POST"
            action="/.netlify/functions/sync-test"
          >

            <button type="submit">
              TESTER LE POST
            </button>

          </form>

        </body>

        </html>
      `
    };
  }


  // Quand tu appuies sur le bouton
  if (event.httpMethod === 'POST') {

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
          message: 'POST MATCHSCOPE OK',
          method: event.httpMethod,
          netlifyFunction: 'sync-test'
        },
        null,
        2
      )
    };
  }


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
};
