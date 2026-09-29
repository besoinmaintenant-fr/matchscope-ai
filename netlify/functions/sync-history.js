const {
  supabaseRequest
} = require('./lib/supabase');


const API =
  'https://api.sportmonks.com/v3/football';


const LEAGUES = {
  '8': {
    code: 'PL',
    name: 'Premier League'
  },

  '82': {
    code: 'BL',
    name: 'Bundesliga'
  },

  '564': {
    code: 'LL',
    name: 'La Liga'
  }
};


const LEAGUE_IDS =
  Object.keys(LEAGUES);


const SEED_DAYS = 365;
const SEED_PART_DAYS = 55;

const SEED_PARTS =
  Math.ceil(
    SEED_DAYS /
    SEED_PART_DAYS
  );


const INCREMENTAL_DAYS = 14;
const BATCH_SIZE = 100;


const FINAL_STATE_IDS =
  new Set([
    5,
    7,
    8
  ]);


const STATE_LABELS = {
  5: 'FT',
  7: 'AET',
  8: 'FT_PEN'
};


// =====================================================
// JSON RESPONSE
// =====================================================

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


// =====================================================
// BODY
// =====================================================

function parseBody(event) {

  if (!event?.body) {
    return {};
  }

  try {

    return JSON.parse(
      event.body
    );

  } catch {

    return {};
  }
}


// =====================================================
// SECURITY
// =====================================================

function authorized(
  body
) {

  const expected =
    process.env
      .MATCHSCOPE_SYNC_SECRET;


  if (!expected) {

    return {
      ok: false,
      error:
        'MATCHSCOPE_SYNC_SECRET absent dans Netlify.'
    };
  }


  const received =
    typeof body?.secret === 'string'
      ? body.secret.trim()
      : '';


  if (
    received !==
    expected
  ) {

    return {
      ok: false,
      error:
        'Accès non autorisé.'
    };
  }


  return {
    ok: true
  };
}


// =====================================================
// DATES
// =====================================================

function startUtcDay(
  value = new Date()
) {

  const date =
    new Date(value);

  date.setUTCHours(
    0,
    0,
    0,
    0
  );

  return date;
}


function addDays(
  value,
  days
) {

  const date =
    new Date(value);

  date.setUTCDate(
    date.getUTCDate()
    +
    days
  );

  return date;
}


function iso(date) {

  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


function daysInclusive(
  start,
  end
) {

  return (
    Math.floor(
      (
        startUtcDay(end).getTime()
        -
        startUtcDay(start).getTime()
      )
      /
      86400000
    )
    +
    1
  );
}


// =====================================================
// SEED RANGE
// =====================================================

function getSeedRange(
  part
) {

  const end =
    startUtcDay();

  end.setUTCDate(
    end.getUTCDate() - 1
  );


  const start =
    addDays(
      end,
      -(SEED_DAYS - 1)
    );


  const offset =
    (part - 1)
    *
    SEED_PART_DAYS;


  const partStart =
    addDays(
      start,
      offset
    );


  let partEnd =
    addDays(
      partStart,
      SEED_PART_DAYS - 1
    );


  if (
    partEnd > end
  ) {
    partEnd =
      new Date(end);
  }


  return {
    start:
      partStart,

    end:
      partEnd
  };
}


// =====================================================
// INCREMENTAL RANGE
// =====================================================

function getIncrementalRange() {

  const end =
    startUtcDay();

  end.setUTCDate(
    end.getUTCDate() - 1
  );


  const start =
    addDays(
      end,
      -(INCREMENTAL_DAYS - 1)
    );


  return {
    start,
    end
  };
}


// =====================================================
// HELPERS
// =====================================================

function numberOrNull(
  value
) {

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function parseKickoff(
  value
) {

  if (!value) {
    return null;
  }


  const raw =
    String(value).trim();


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
    new Date(raw);


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
      team =>
        team?.meta?.location ===
        location
    )
    ||
    null
  );
}


// =====================================================
// FINAL SCORE
// =====================================================

function getFinalScore(
  scores = []
) {

  let home = null;
  let away = null;


  for (
    const item
    of scores
  ) {

    if (
      item?.description !==
      'CURRENT'
    ) {
      continue;
    }


    const side =
      item?.score?.participant;


    const goals =
      Number(
        item?.score?.goals
      );


    if (
      !Number.isFinite(goals)
    ) {
      continue;
    }


    if (
      side === 'home'
    ) {
      home = goals;
    }


    if (
      side === 'away'
    ) {
      away = goals;
    }
  }


  return {
    home,
    away
  };
}


function result1x2(
  home,
  away
) {

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
// SPORTMONKS
// =====================================================

async function fetchRange(
  token,
  start,
  end
) {

  const fixtures = [];

  let page = 1;
  let hasMore = true;


  while (hasMore) {

    if (
      page > 50
    ) {

      throw new Error(
        'Pagination Sportmonks anormalement longue.'
      );
    }


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
      `fixtureLeagues:${LEAGUE_IDS.join(',')}`
    );


    url.searchParams.set(
      'include',
      'league;participants;scores;state'
    );


    url.searchParams.set(
      'per_page',
      '50'
    );


    url.searchParams.set(
      'page',
      String(page)
    );


    const response =
      await fetch(url);


    const text =
      await response.text();


    let payload;


    try {

      payload =
        JSON.parse(text);

    } catch {

      throw new Error(
        'Réponse Sportmonks invalide.'
      );
    }


    if (!response.ok) {

      throw new Error(
        `Sportmonks ${response.status} : ${text.slice(0, 500)}`
      );
    }


    if (
      Array.isArray(
        payload?.data
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


  return fixtures;
}


// =====================================================
// TRANSFORM
// =====================================================

function transformFixture(
  fixture
) {

  const league =
    LEAGUES[
      String(
        fixture?.league_id
      )
    ];


  if (!league) {
    return null;
  }


  const stateId =
    Number(
      fixture?.state_id
    );


  if (
    !FINAL_STATE_IDS.has(
      stateId
    )
  ) {

    return null;
  }


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
    );


  const away =
    getTeam(
      participants,
      'away'
    );


  if (
    !home ||
    !away
  ) {
    return null;
  }


  const kickoff =
    parseKickoff(
      fixture?.starting_at
    );


  if (!kickoff) {
    return null;
  }


  const score =
    getFinalScore(
      Array.isArray(
        fixture?.scores
      )
        ? fixture.scores
        : []
    );


  if (
    score.home === null
    ||
    score.away === null
  ) {

    return null;
  }


  const fixtureId =
    numberOrNull(
      fixture?.id
    );


  if (
    fixtureId === null
  ) {

    return null;
  }


  const now =
    new Date()
      .toISOString();


  return {

    match: {

      sportmonks_fixture_id:
        fixtureId,

      league_id:
        Number(
          fixture.league_id
        ),

      league_code:
        league.code,

      league_name:
        fixture?.league?.name
        ||
        league.name,

      season_id:
        numberOrNull(
          fixture?.season_id
        ),

      starting_at:
        kickoff.toISOString(),

      status:
        fixture
          ?.state
          ?.short_name
        ||
        STATE_LABELS[stateId]
        ||
        'FT',

      home_team_id:
        numberOrNull(
          home.id
        ),

      home_team_name:
        home.name,

      away_team_id:
        numberOrNull(
          away.id
        ),

      away_team_name:
        away.name,

      updated_at:
        now
    },


    result: {

      sportmonks_fixture_id:
        fixtureId,

      home_score:
        score.home,

      away_score:
        score.away,

      result_1x2:
        result1x2(
          score.home,
          score.away
        ),

      finished_at:
        null,

      updated_at:
        now
    }
  };
}


// =====================================================
// BATCHES
// =====================================================

function chunks(
  data,
  size
) {

  const output = [];


  for (
    let i = 0;
    i < data.length;
    i += size
  ) {

    output.push(
      data.slice(
        i,
        i + size
      )
    );
  }


  return output;
}


// =====================================================
// SAVE SUPABASE
// =====================================================

async function saveMatches(
  matches
) {

  for (
    const batch
    of chunks(
      matches,
      BATCH_SIZE
    )
  ) {

    await supabaseRequest(
      'matches',
      {
        method:
          'POST',

        query:
          '?on_conflict=sportmonks_fixture_id',

        body:
          batch,

        prefer:
          'resolution=merge-duplicates,return=minimal'
      }
    );
  }
}


async function saveResults(
  results
) {

  for (
    const batch
    of chunks(
      results,
      BATCH_SIZE
    )
  ) {

    await supabaseRequest(
      'results',
      {
        method:
          'POST',

        query:
          '?on_conflict=sportmonks_fixture_id',

        body:
          batch,

        prefer:
          'resolution=merge-duplicates,return=minimal'
      }
    );
  }
}


// =====================================================
// NETLIFY HANDLER
// =====================================================

exports.handler =
  async event => {

    if (
      event.httpMethod !==
      'POST'
    ) {

      return jsonResponse(
        405,
        {
          success: false,
          error:
            'Méthode non autorisée.'
        }
      );
    }


    const body =
      parseBody(event);


    const access =
      authorized(body);


    if (!access.ok) {

      return jsonResponse(
        401,
        {
          success: false,
          error:
            access.error
        }
      );
    }


    const mode =
      body?.mode === 'seed'
        ? 'seed'
        : 'incremental';


    let part = null;
    let range;


    // =================================================
    // VALIDATION AVANT SPORTMONKS / SUPABASE
    // =================================================

    if (
      mode === 'seed'
    ) {

      part =
        Number(
          body?.part
        );


      if (
        !Number.isInteger(part)
        ||
        part < 1
        ||
        part > SEED_PARTS
      ) {

        return jsonResponse(
          400,
          {
            success:
              false,

            error:
              'SEED_PART_REQUIRED',

            seedParts:
              SEED_PARTS,

            daysPerPart:
              SEED_PART_DAYS,

            message:
              `Utilise une partie comprise entre 1 et ${SEED_PARTS}.`
          }
        );
      }


      range =
        getSeedRange(part);

    } else {

      range =
        getIncrementalRange();
    }


    const token =
      process.env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      return jsonResponse(
        500,
        {
          success:
            false,

          error:
            'SPORTMONKS_API_TOKEN absent.'
        }
      );
    }


    try {

      const rawFixtures =
        await fetchRange(
          token,
          range.start,
          range.end
        );


      const unique =
        new Map();


      for (
        const fixture
        of rawFixtures
      ) {

        if (
          fixture?.id !==
          null
          &&
          fixture?.id !==
          undefined
        ) {

          unique.set(
            String(
              fixture.id
            ),
            fixture
          );
        }
      }


      const transformed =
        Array
          .from(
            unique.values()
          )
          .map(
            transformFixture
          )
          .filter(Boolean);


      const matches =
        transformed.map(
          item =>
            item.match
        );


      const results =
        transformed.map(
          item =>
            item.result
        );


      await saveMatches(
        matches
      );


      await saveResults(
        results
      );


      const leagues = {};


      for (
        const match
        of matches
      ) {

        leagues[
          match.league_code
        ] =
          (
            leagues[
              match.league_code
            ]
            ||
            0
          )
          +
          1;
      }


      return jsonResponse(
        200,
        {
          success:
            true,

          mode,

          part,

          seedParts:
            mode === 'seed'
              ? SEED_PARTS
              : null,

          nextPart:
            mode === 'seed'
            &&
            part < SEED_PARTS
              ? part + 1
              : null,

          from:
            iso(
              range.start
            ),

          to:
            iso(
              range.end
            ),

          days:
            daysInclusive(
              range.start,
              range.end
            ),

          sportmonksFixtures:
            rawFixtures.length,

          uniqueFixtures:
            unique.size,

          storedMatches:
            matches.length,

          storedResults:
            results.length,

          leagues,

          message:
            mode === 'seed'
              ? `Seed ${part}/${SEED_PARTS} terminé.`
              : 'Synchronisation incrémentale terminée.'
        }
      );


    } catch (error) {

      console.error(
        'sync-history',
        error
      );


      return jsonResponse(
        500,
        {
          success:
            false,

          mode,

          part,

          error:
            'Erreur de synchronisation.',

          details:
            error?.message
            ||
            String(error)
        }
      );
    }
  };
