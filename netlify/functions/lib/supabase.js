const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;


function checkConfig() {

  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY
  ) {

    throw new Error(
      'Configuration Supabase absente.'
    );
  }
}


async function supabaseRequest(
  table,
  options = {}
) {

  checkConfig();


  const {
    method = 'GET',
    query = '',
    body = null,
    prefer = 'return=representation'
  } = options;


  const url =
    `${SUPABASE_URL}/rest/v1/${table}${query}`;


  const headers = {

    apikey:
      SUPABASE_SECRET_KEY,

    Authorization:
      `Bearer ${SUPABASE_SECRET_KEY}`,

    'Content-Type':
      'application/json',

    Prefer:
      prefer
  };


  const response =
    await fetch(
      url,
      {

        method,

        headers,

        body:

          body === null

            ? undefined

            : JSON.stringify(
                body
              )
      }
    );


  const text =
    await response.text();


  let data =
    null;


  if (
    text
  ) {

    try {

      data =
        JSON.parse(
          text
        );

    } catch {

      data =
        text;
    }
  }


  if (
    !response.ok
  ) {

    throw new Error(

      `Supabase ${response.status} : ${
        typeof data === 'string'
          ? data
          : JSON.stringify(data)
      }`
    );
  }


  return data;
}


module.exports = {

  supabaseRequest
};
