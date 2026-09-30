const {
  supabaseRequest
} = require('./lib/supabase');


const DB_PAGE_SIZE =
  1000;


const ID_QUERY_CHUNK =
  100;


function array(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


function chunks(
  data,
  size
) {

  const output =
    [];


  for (
    let index = 0;
    index < data.length;
    index += size
  ) {

    output.push(

      data.slice(
        index,
        index + size
      )
    );
  }


  return output;
}


async function loadTargets() {

  const rows =
    [];

  let offset =
    0;


  while (
    true
  ) {

    const page =
      await supabaseRequest(
        'matches',
        {

          method:
            'GET',

          query:

            '?select=sportmonks_fixture_id'

            +

            '&league_code=in.(PL,BL,LL)'

            +

            '&lineups_confirmed=eq.true'

            +

            `&limit=${DB_PAGE_SIZE}`

            +

            `&offset=${offset}`
        }
      );


    if (
      !Array.isArray(
        page
      )
    ) {

      throw new Error(
        'Réponse matches invalide.'
      );
    }


    rows.push(
      ...page
    );


    if (
      page.length <
      DB_PAGE_SIZE
    ) {

      break;
    }


    offset +=
      DB_PAGE_SIZE;
  }


  return rows

    .map(
      row =>
        Number(
          row?.sportmonks_fixture_id
        )
    )

    .filter(
      Number.isFinite
    );
}


async function loadExisting(
  ids
) {

  const found =
    new Set();


  for (
    const part
    of chunks(
      ids,
      ID_QUERY_CHUNK
    )
  ) {

    if (
      !part.length
    ) {

      continue;
    }


    const rows =
      await supabaseRequest(
        'fixture_enrichment',
        {

          method:
            'GET',

          query:

            '?select=sportmonks_fixture_id'

            +

            `&sportmonks_fixture_id=in.(${part.join(',')})`
        }
      );


    for (
      const row
      of array(
        rows
      )
    ) {

      const id =
        Number(
          row?.sportmonks_fixture_id
        );


      if (
        Number.isFinite(
          id
        )
      ) {

        found.add(
          id
        );
      }
    }
  }


  return found;
}


exports.handler =
  async event => {

    if (
      event.httpMethod !==
      'GET'
    ) {

      return {

        statusCode:
          405,

        headers: {

          'content-type':
            'application/json'
        },

        body:
          JSON.stringify({

            error:
              'GET requis.'
          })
      };
    }


    try {

      const targetIds =
        await loadTargets();


      const existing =
        await loadExisting(
          targetIds
        );


      const target =
        targetIds.length;


      const enriched =
        existing.size;


      const remaining =
        Math.max(

          0,

          target -
          enriched
        );


      const progress =

        target

          ? Math.round(

              (
                enriched /
                target
              )
              *
              1000

            )
            /
            10

          : 0;


      return {

        statusCode:
          200,

        headers: {

          'content-type':
            'application/json',

          'cache-control':
            'no-store'
        },

        body:
          JSON.stringify({

            target,

            enriched,

            remaining,

            progress,

            done:
              remaining === 0
          })
      };


    } catch (
      error
    ) {

      return {

        statusCode:
          500,

        headers: {

          'content-type':
            'application/json'
        },

        body:
          JSON.stringify({

            error:
              error?.message
              ||
              String(error)
          })
      };
    }
  };
