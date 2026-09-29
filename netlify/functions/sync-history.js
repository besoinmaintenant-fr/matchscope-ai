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


/*
 * Sportmonks limite la route "between"
 * à 100 jours.
 *
 * On reste volontairement à 90.
 */
const CHUNK_DAYS =
  90;


const BATCH_SIZE =
  100;


/*
 * États Sportmonks réellement terminés.
 *
 * 5 = FT
 * 7 = AET
 * 8 = fin après tirs au but
 *
 * Pour PL / BL / LL, FT sera de très loin
 * le cas normal.
 */
const FINAL_STATE_IDS =
  new Set([
    5,
    7,
    8
  ]);


const STATE_LABELS = {

  5:
    'FT',

  7:
    'AET',

  8:
    'FT_PEN'
};


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

      ok:
        false,

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

    copy.getUTCDate()

    +

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
// OUTILS
// =====================================================

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
// ÉTAT DU MATCH
// =====================================================

function fixtureState(
  fixture
) {

  const stateId =
    Number(
      fixture?.state_id
    );


  const includedState =
    fixture?.state
    ||
    null;


  const code =

    includedState?.short_name

    ||

    includedState?.state

    ||

    STATE_LABELS[
      stateId
    ]

    ||

    null;


  return {

    id:
      Number.isFinite(
        stateId
      )
        ? stateId
        : null,

    code,

    finished:
      FINAL_STATE_IDS.has(
        stateId
      )
  };
}


// =====================================================
// SCORE FINAL
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

      /*
       * Sportmonks documente CURRENT
       * comme le score courant/final.
       *
       * Comme on vérifie AVANT l'état
       * final du fixture, il ne peut plus
       * s'agir ici d'un simple score live.
       */

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
        side === 'home'

        &&

        Number.isFinite(
          goals
        )
      ) {

        result.home =
          goals;
      }


      if (
        side === 'away'

        &&

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
     * state est ajouté explicitement.
     *
     * state_id existe déjà sur le fixture,
     * mais l'include nous donne également
     * le code lisible pour diagnostic.
     */

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

        `Sportmonks ${response.status} : ${raw.slice(
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


    page +=
      1;
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

    return {

      stored:
        false,

      reason:
        'league'
    };
  }


  /*
   * CRITIQUE :
   *
   * on vérifie maintenant l'état Sportmonks
   * AVANT de considérer CURRENT comme final.
   */

  const state =
    fixtureState(
      fixture
    );


  if (
    !state.finished
  ) {

    return {

      stored:
        false,

      reason:
        'not-final',

      stateId:
        state.id,

      state:
        state.code
    };
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

    return {

      stored:
        false,

      reason:
        'participants'
    };
  }


  const kickoff =
    parseKickoff(
      fixture.starting_at
    );


  if (!kickoff) {

    return {

      stored:
        false,

      reason:
        'kickoff'
    };
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
    score.home === null ||
    score.away === null
  ) {

    return {

      stored:
        false,

      reason:
        'score'
    };
  }


  const fixtureId =
    numberOrNull(
      fixture.id
    );


  if (
    fixtureId === null
  ) {

    return {

      stored:
        false,

      reason:
        'fixture-id'
    };
  }


  const now =
    new Date()
      .toISOString();


  return {

    stored:
      true,


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
        state.code
        ||
        STATE_LABELS[
          state.id
        ]
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
        getResult(
          score.home,
          score.away
        ),

      /*
       * On ne connaît pas ici avec précision
       * l'heure de fin du match.
       *
       * On préfère NULL plutôt qu'une heure
       * inventée.
       */

      finished_at:
        null,

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

  if (
    !matches.length
  ) {

    return;
  }


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
         * Merge uniquement sur les colonnes
         * présentes dans nos lignes.
         *
         * Les données plus riches déjà stockées
         * ailleurs ne doivent pas être remplacées
         * volontairement par ce job historique.
         */

        prefer:
          'resolution=merge-duplicates,return=minimal'
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

  if (
    !results.length
  ) {

    return;
  }


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
          'resolution=merge-duplicates,return=minimal'
      }
    );
  }
}


// =====================================================
// DIAGNOSTIC DES ÉTATS IGNORÉS
// =====================================================

function countSkippedStates(
  transformed
) {

  const result =
    {};


  transformed

    .filter(
      item =>

        !item.stored

        &&

        item.reason ===
        'not-final'
    )

    .forEach(
      item => {

        const key =

          item.state

          ||

          (
            item.stateId !==
            null

              ? `STATE_${item.stateId}`

              : 'UNKNOWN'
          );


        result[
          key
        ] =

          (
            result[
              key
            ]

            ||

            0
          )

          +

          1;
      }
    );


  return result;
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

          success:
            false,

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

          success:
            false,

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

          success:
            false,

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
     * suivantes = 14 jours.
     */

    const mode =

      event
        ?.queryStringParameters
        ?.mode ===
      'seed'

        ? 'seed'

        : 'incremental';


    const days =

      mode ===
      'seed'

        ? SEED_DAYS

        : INCREMENTAL_DAYS;


    /*
     * Historique modèle :
     * on s'arrête à hier.
     *
     * Les matchs terminés aujourd'hui pourront
     * être gérés immédiatement par finalize-match
     * ou entrer dans le prochain incrémental.
     */

    const end =
      new Date();


    end.setUTCHours(
      0,
      0,
      0,
      0
    );


    end.setUTCDate(

      end.getUTCDate()

      -

      1
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

      // ===============================================
      // SPORTMONKS
      // ===============================================

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


      // ===============================================
      // DÉDUPLICATION
      // ===============================================

      const unique =
        new Map();


      rawFixtures.forEach(
        fixture => {

          if (
            fixture?.id !==
            undefined

            &&

            fixture?.id !==
            null
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


      // ===============================================
      // TRANSFORMATION + VALIDATION
      // ===============================================

      const transformed =
        Array
          .from(
            unique.values()
          )
          .map(
            transformFixture
          );


      const valid =
        transformed.filter(
          item =>
            item.stored
        );


      const matches =
        valid.map(
          item =>
            item.match
        );


      const results =
        valid.map(
          item =>
            item.result
        );


      /*
       * Matches AVANT results :
       * FK results -> matches.
       */

      await saveMatches(
        matches
      );


      await saveResults(
        results
      );


      // ===============================================
      // COMPTAGE PAR CHAMPIONNAT
      // ===============================================

      const leagueCounts =
        {};


      matches.forEach(
        match => {

          const code =
            match.league_code;


          leagueCounts[
            code
          ] =

            (
              leagueCounts[
                code
              ]

              ||

              0
            )

            +

            1;
        }
      );


      // ===============================================
      // RAISONS D'EXCLUSION
      // ===============================================

      const skipped = {

        notFinal:
          transformed.filter(
            item =>
              !item.stored &&
              item.reason ===
              'not-final'
          ).length,

        missingScore:
          transformed.filter(
            item =>
              !item.stored &&
              item.reason ===
              'score'
          ).length,

        missingParticipants:
          transformed.filter(
            item =>
              !item.stored &&
              item.reason ===
              'participants'
          ).length,

        invalidKickoff:
          transformed.filter(
            item =>
              !item.stored &&
              item.reason ===
              'kickoff'
          ).length,

        invalidFixtureId:
          transformed.filter(
            item =>
              !item.stored &&
              item.reason ===
              'fixture-id'
          ).length,

        states:
          countSkippedStates(
            transformed
          )
      };


      return jsonResponse(
        200,
        {

          success:
            true,

          mode,

          days,

          from:
            iso(
              start
            ),

          to:
            iso(
              end
            ),

          chunks:
            ranges.length,

          sportmonksFixtures:
            rawFixtures.length,

          uniqueFixtures:
            unique.size,

          completedFixtures:
            valid.length,

          storedMatches:
            matches.length,

          storedResults:
            results.length,

          leagues:
            leagueCounts,

          skipped,

          finalStateIds:
            Array.from(
              FINAL_STATE_IDS
            ),

          message:

            mode ===
            'seed'

              ? 'Historique initial MatchScope synchronisé avec contrôle des états finaux.'

              : 'Mise à jour MatchScope terminée avec contrôle des états finaux.'
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
            String(
              error
            )
        }
      );
    }
  };
