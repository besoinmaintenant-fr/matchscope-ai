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


const SEED_DAYS =
  365;


const INCREMENTAL_DAYS =
  14;


const CHUNK_DAYS =
  90;


const BATCH_SIZE =
  100;


// =====================================================
// RÉPONSE
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
        'no-store'
    },

    body:
      JSON.stringify(
        body
      )
  };
}


// =====================================================
// SÉCURITÉ
// =====================================================

function authorized(
  event
) {

  const secret =
    process
      .env
      .MATCHSCOPE_SYNC_SECRET;


  if (!secret) {

    return {
      ok: false,
      reason:
        'MATCHSCOPE_SYNC_SECRET absent.'
    };
  }


  const authorization =

    event
      ?.headers
      ?.authorization

    ||

    event
      ?.headers
      ?.Authorization

    ||

    '';


  return {

    ok:
      authorization ===
      `Bearer ${secret}`,

    reason:
      'Accès non autorisé.'
  };
}


// =====================================================
// DATES
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
    String(value)
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
    new Date(raw);


  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


function buildRanges(
  start,
  end
) {

  const ranges =
    [];


  let cursor =
    new Date(start);


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
        new Date(end);
    }


    ranges.push({

      start:
        new Date(cursor),

      end:
        new Date(rangeEnd)
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
// OUTILS
// =====================================================

function numberOrNull(
  value
) {

  const number =
    Number(value);


  return Number.isFinite(
    number
  )
    ? number
    : null;
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


// =====================================================
// SCORE
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
        Number(
          item
            ?.score
            ?.goals
        );


      if (
        side === 'home' &&
        Number.isFinite(goals)
      ) {

        result.home =
          goals;
      }


      if (
        side === 'away' &&
        Number.isFinite(goals)
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


    /*
     * Pour l'instant :
     * uniquement les données nécessaires
     * au moteur V0.7.
     */

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
      String(page)
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

        `Sportmonks ${response.status} : ${raw.slice(
          0,
          500
        )}`
      );
    }


    let payload;


    try {

      payload =
        JSON.parse(raw);

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
// TRANSFORMATION
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
      fixture.starting_at
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


  /*
   * Pas de score complet :
   * on n'enregistre pas le résultat.
   *
   * Cela évite aussi les matchs reportés,
   * annulés ou non joués.
   */

  if (
    score.home === null ||
    score.away === null
  ) {

    return null;
  }


  const fixtureId =
    numberOrNull(
      fixture.id
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
          fixture.season_id
        ),

      starting_at:
        kickoff.toISOString(),

      status:
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
        getResult(
          score.home,
          score.away
        ),

      updated_at:
        now
    }
  };
}


// =====================================================
// DÉCOUPAGE BATCH
// =====================================================

function chunks(
  array,
  size
) {

  const result =
    [];


  for (
    let index = 0;
    index < array.length;
    index += size
  ) {

    result.push(

      array.slice(
        index,
        index + size
      )
    );
  }


  return result;
}


// =====================================================
// SUPABASE : MATCHS
// =====================================================

async function saveMatches(
  matches
) {

  const batches =
    chunks(
      matches,
      BATCH_SIZE
    );


  for (
    const batch
    of batches
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

        /*
         * Important :
         * on ne touche pas ici aux compositions
         * ni aux données détaillées déjà présentes.
         */

        prefer:
          'resolution=merge-duplicates,missing=default,return=minimal'
      }
    );
  }
}


// =====================================================
// SUPABASE : RÉSULTATS
// =====================================================

async function saveResults(
  results
) {

  const batches =
    chunks(
      results,
      BATCH_SIZE
    );


  for (
    const batch
    of batches
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
          'resolution=merge-duplicates,missing=default,return=minimal'
      }
    );
  }
}


// =====================================================
// HANDLER
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

          error:
            'Méthode non autorisée.'
        }
      );
    }


    const access =
      authorized(
        event
      );


    if (
      !access.ok
    ) {

      return jsonResponse(
        401,
        {

          error:
            access.reason
        }
      );
    }


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


    /*
     * seed :
     * première importation = 365 jours.
     *
     * incremental :
     * mises à jour suivantes = 14 jours.
     */

    const mode =

      event
        ?.queryStringParameters
        ?.mode === 'seed'

        ? 'seed'

        : 'incremental';


    const days =

      mode === 'seed'

        ? SEED_DAYS

        : INCREMENTAL_DAYS;


    /*
     * On s'arrête volontairement à hier.
     *
     * Ainsi un match actuellement en cours
     * ne peut jamais être enregistré comme
     * résultat final par cette fonction.
     */

    const end =
      new Date();


    end.setUTCDate(
      end.getUTCDate() - 1
    );


    const start =
      addDays(
        end,
        -(days - 1)
      );


    const ranges =
      buildRanges(
        start,
        end
      );


    try {

      /*
       * Première importation :
       * environ 5 blocs maximum.
       *
       * Ensuite l'incrémental ne demandera
       * normalement qu'un seul bloc.
       */

      const fetched =
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
        fetched.flat();


      /*
       * Déduplication par fixture ID.
       */

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


      /*
       * Important :
       *
       * matches AVANT results
       * à cause de la clé étrangère.
       */

      await saveMatches(
        matches
      );


      await saveResults(
        results
      );


      const leagueCounts =
        {};


      matches.forEach(
        match => {

          const code =
            match.league_code;


          leagueCounts[code] =

            (
              leagueCounts[code]
              ||
              0
            )

            +

            1;
        }
      );


      return jsonResponse(
        200,
        {

          success:
            true,

          mode,

          days,

          from:
            iso(start),

          to:
            iso(end),

          sportmonksFixtures:
            rawFixtures.length,

          uniqueFixtures:
            unique.size,

          storedMatches:
            matches.length,

          storedResults:
            results.length,

          leagues:
            leagueCounts,

          message:

            mode === 'seed'

              ? 'Historique initial MatchScope synchronisé.'

              : 'Mise à jour MatchScope terminée.'
        }
      );


    } catch (
      error
    ) {

      console.error(
        'MatchScope sync-history:',
        error
      );


      return jsonResponse(
        500,
        {

          success:
            false,

          error:
            'Erreur de synchronisation historique.',

          details:
            error?.message
            ||
            String(error)
        }
      );
    }
  };
