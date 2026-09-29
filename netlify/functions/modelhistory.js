const {
  supabaseRequest
} = require('./lib/supabase');


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


const CHUNK_DAYS =
  90;


/*
 * On garde volontairement v2 :
 * le format envoyé à model.js
 * reste compatible avec V0.7.
 */
const ENGINE_VERSION =
  'modelhistory-v2';


/*
 * Supabase peut limiter le nombre
 * de lignes retournées par requête.
 */
const SUPABASE_PAGE_SIZE =
  1000;


/*
 * Sécurité :
 * si Supabase est encore trop vide,
 * V0.7 reste sur Sportmonks.
 */
const MIN_SUPABASE_MATCHES =
  850;


const MIN_MATCHES_PER_LEAGUE =
  180;


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
      .test(raw)
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


function numberOrNull(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


// =====================================================
// RANGES SPORTMONKS
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
      rangeEnd > end
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
// ÉQUIPES SPORTMONKS
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
// SCORE SPORTMONKS
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
        numberOrNull(
          item
            ?.score
            ?.goals
        );


      if (
        side === 'home' &&
        goals !== null
      ) {

        result.home =
          goals;
      }


      if (
        side === 'away' &&
        goals !== null
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
    home > away
  ) {

    return '1';
  }


  if (
    away > home
  ) {

    return '2';
  }


  return 'N';
}


// =====================================================
// COMPTAGE PAR LIGUE
// =====================================================

function countLeagues(
  matches
) {

  const leagues =
    {};


  matches.forEach(
    match => {

      const code =
        match.competition;


      leagues[code] =

        (
          leagues[code]
          ||
          0
        )

        +

        1;
    }
  );


  return leagues;
}


// =====================================================
// TRANSFORMATION SUPABASE
// =====================================================

function transformSupabaseRow(
  row
) {

  const kickoff =
    parseKickoff(
      row.starting_at
    );


  const homeScore =
    numberOrNull(
      row.home_score
    );


  const awayScore =
    numberOrNull(
      row.away_score
    );


  if (
    !kickoff ||
    homeScore === null ||
    awayScore === null
  ) {

    return null;
  }


  if (
    ![
      'PL',
      'BL',
      'LL'
    ].includes(
      row.league_code
    )
  ) {

    return null;
  }


  if (
    ![
      '1',
      'N',
      '2'
    ].includes(
      row.result_1x2
    )
  ) {

    return null;
  }


  return {

    id:
      String(
        row.sportmonks_fixture_id
      ),

    competition:
      row.league_code,

    competitionName:
      row.league_name
      ||
      row.league_code,

    home:
      row.home_team_name
      ||
      'Domicile',

    away:
      row.away_team_name
      ||
      'Extérieur',

    homeId:
      numberOrNull(
        row.home_team_id
      ),

    awayId:
      numberOrNull(
        row.away_team_id
      ),

    startingAt:
      kickoff.toISOString(),

    kickoffTs:
      kickoff.getTime(),

    score: {

      home:
        homeScore,

      away:
        awayScore
    },

    actualResult:
      row.result_1x2
  };
}


// =====================================================
// CHARGEMENT SUPABASE
// =====================================================

async function loadSupabaseHistory(
  start,
  end
) {

  const rows =
    [];


  let offset =
    0;


  while (true) {

    const query =

      '?select='

      +

      [
        'sportmonks_fixture_id',
        'league_code',
        'league_name',
        'home_team_id',
        'home_team_name',
        'away_team_id',
        'away_team_name',
        'starting_at',
        'home_score',
        'away_score',
        'result_1x2'
      ].join(',')

      +

      `&starting_at=gte.${encodeURIComponent(
        start.toISOString()
      )}`

      +

      `&starting_at=lte.${encodeURIComponent(
        end.toISOString()
      )}`

      +

      '&order=starting_at.asc'

      +

      `&limit=${SUPABASE_PAGE_SIZE}`

      +

      `&offset=${offset}`;


    const page =
      await supabaseRequest(
        'model_history',
        {

          method:
            'GET',

          query
        }
      );


    if (
      !Array.isArray(
        page
      )
    ) {

      throw new Error(
        'Réponse Supabase model_history invalide.'
      );
    }


    rows.push(
      ...page
    );


    if (
      page.length <
      SUPABASE_PAGE_SIZE
    ) {

      break;
    }


    offset +=
      SUPABASE_PAGE_SIZE;


    /*
     * Protection contre une boucle
     * anormale.
     */

    if (
      offset > 10000
    ) {

      throw new Error(
        'Pagination Supabase anormalement longue.'
      );
    }
  }


  const matches =

    rows

      .map(
        transformSupabaseRow
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


  return matches;
}


// =====================================================
// BASE SUPABASE SUFFISANTE ?
// =====================================================

function supabaseIsReady(
  matches
) {

  if (
    matches.length <
    MIN_SUPABASE_MATCHES
  ) {

    return false;
  }


  const leagues =
    countLeagues(
      matches
    );


  for (
    const code
    of [
      'PL',
      'BL',
      'LL'
    ]
  ) {

    if (
      Number(
        leagues[code] || 0
      ) <
      MIN_MATCHES_PER_LEAGUE
    ) {

      return false;
    }
  }


  return true;
}


// =====================================================
// SPORTMONKS : UN BLOC
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

      `${API}/fixtures/between/${iso(
        range.start
      )}/${iso(
        range.end
      )}`;


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


    const response =
      await fetch(
        url
      );


    const raw =
      await response.text();


    if (
      !response.ok
    ) {

      throw new Error(

        `Sportmonks ${response.status} sur ${iso(
          range.start
        )} -> ${iso(
          range.end
        )} : ${raw.slice(
          0,
          500
        )}`
      );
    }


    let payload;


    try {

      payload =
        JSON.parse(
          raw
        );

    } catch {

      throw new Error(
        'Réponse Sportmonks invalide.'
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


    page += 1;
  }


  if (
    hasMore
  ) {

    throw new Error(
      'Pagination Sportmonks incomplète.'
    );
  }


  return fixtures;
}


// =====================================================
// TRANSFORMATION SPORTMONKS
// =====================================================

function transformSportmonksFixture(
  fixture
) {

  const participants =

    Array.isArray(
      fixture?.participants
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
        fixture?.scores
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


  if (!kickoff) {

    return null;
  }


  const league =

    LEAGUES[
      String(
        fixture.league_id
      )
    ];


  if (!league) {

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
      fixture?.league?.name
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
// FALLBACK SPORTMONKS
// =====================================================

async function loadSportmonksHistory(
  token,
  start,
  end
) {

  const ranges =
    buildRanges(
      start,
      end
    );


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


  const unique =
    new Map();


  rawFixtures.forEach(
    fixture => {

      if (
        fixture?.id !== undefined &&
        fixture?.id !== null
      ) {

        unique.set(

          String(
            fixture.id
          ),

          fixture
        );
      }
    }
  );


  const matches =

    Array
      .from(
        unique.values()
      )

      .map(
        transformSportmonksFixture
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


  return {

    matches,

    rawCount:
      rawFixtures.length,

    ranges
  };
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
// HANDLER
// =====================================================

exports.handler =
  async () => {

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


    let supabaseMatches =
      [];


    let supabaseError =
      null;


    // ---------------------------------
    // 1. ESSAYER SUPABASE
    // ---------------------------------

    try {

      supabaseMatches =
        await loadSupabaseHistory(
          start,
          end
        );


      if (
        supabaseIsReady(
          supabaseMatches
        )
      ) {

        const leagues =
          countLeagues(
            supabaseMatches
          );


        return jsonResponse(
          200,
          {

            engineVersion:
              ENGINE_VERSION,

            mode:
              'model-history',

            source:
              'supabase',

            days:
              TOTAL_DAYS,

            chunkDays:
              0,

            chunks:
              0,

            from:
              iso(start),

            to:
              iso(end),

            rawCount:
              supabaseMatches.length,

            count:
              supabaseMatches.length,

            leagues,

            ranges:
              [],

            matches:
              supabaseMatches
          }
        );
      }


      supabaseError =

        `Base MatchScope insuffisante : ${supabaseMatches.length} matchs.`;

    } catch (
      error
    ) {

      supabaseError =
        error?.message
        ||
        String(error);
    }


    // ---------------------------------
    // 2. FALLBACK SPORTMONKS
    // ---------------------------------

    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      return jsonResponse(
        500,
        {

          engineVersion:
            ENGINE_VERSION,

          error:
            'Historique indisponible.',

          supabaseError,

          details:
            'Supabase incomplet et SPORTMONKS_API_TOKEN absent.'
        }
      );
    }


    try {

      const fallback =
        await loadSportmonksHistory(

          token,

          start,

          end
        );


      const leagues =
        countLeagues(
          fallback.matches
        );


      return jsonResponse(
        200,
        {

          engineVersion:
            ENGINE_VERSION,

          mode:
            'model-history',

          source:
            'sportmonks-fallback',

          days:
            TOTAL_DAYS,

          chunkDays:
            CHUNK_DAYS,

          chunks:
            fallback.ranges.length,

          from:
            iso(start),

          to:
            iso(end),

          rawCount:
            fallback.rawCount,

          count:
            fallback.matches.length,

          leagues,

          supabaseCount:
            supabaseMatches.length,

          supabaseError,

          ranges:

            fallback.ranges.map(
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

          matches:
            fallback.matches
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

          supabaseError,

          details:
            error?.message
            ||
            String(error)
        }
      );
    }
  };
