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


/*
 * Historique total souhaité.
 */
const SEED_DAYS =
  365;


/*
 * Seed découpé en plusieurs parties
 * pour éviter les timeouts Netlify.
 */
const SEED_PART_DAYS =
  55;


const SEED_PARTS =
  Math.ceil(
    SEED_DAYS /
    SEED_PART_DAYS
  );


/*
 * Mise à jour normale après
 * le premier remplissage.
 */
const INCREMENTAL_DAYS =
  14;


const BATCH_SIZE =
  100;


/*
 * États Sportmonks considérés
 * réellement terminés.
 *
 * 5 = FT
 * 7 = AET
 * 8 = fin après tirs au but
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
// RÉPONSE JSON
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


  /*
   * On utilise notre propre header.
   *
   * Pas de Authorization / Bearer.
   */

  const received =

    event
      ?.headers
      ?.['x-matchscope-secret']

    ||

    event
      ?.headers
      ?.['X-MatchScope-Secret']

    ||

    '';


  return {

    ok:
      received ===
      secret,

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


function startOfUtcDay(
  value = new Date()
) {

  const date =
    new Date(
      value
    );


  date.setUTCHours(
    0,
    0,
    0,
    0
  );


  return date;
}


function daysInclusive(
  start,
  end
) {

  return (

    Math.floor(

      (
        startOfUtcDay(
          end
        ).getTime()

        -

        startOfUtcDay(
          start
        ).getTime()
      )

      /

      86400000
    )

    +

    1
  );
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


  /*
   * Format Sportmonks fréquent :
   *
   * 2026-09-29 19:00:00
   */

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


// =====================================================
// PLAGE DU SEED
// =====================================================

function getSeedRange(
  part
) {

  /*
   * Le seed se termine à hier.
   */

  const seedEnd =
    startOfUtcDay(
      new Date()
    );


  seedEnd.setUTCDate(

    seedEnd.getUTCDate()

    -

    1
  );


  /*
   * Début exact des 365 jours.
   */

  const seedStart =
    addDays(

      seedEnd,

      -(SEED_DAYS - 1)
    );


  /*
   * Décalage de la partie.
   */

  const offset =
    (
      part - 1
    )

    *

    SEED_PART_DAYS;


  const partStart =
    addDays(

      seedStart,

      offset
    );


  let partEnd =
    addDays(

      partStart,

      SEED_PART_DAYS - 1
    );


  if (
    partEnd >
    seedEnd
  ) {

    partEnd =
      new Date(
        seedEnd
      );
  }


  if (
    partStart >
    seedEnd
  ) {

    return null;
  }


  return {

    start:
      partStart,

    end:
      partEnd,

    fullStart:
      seedStart,

    fullEnd:
      seedEnd
  };
}


// =====================================================
// PLAGE INCRÉMENTALE
// =====================================================

function getIncrementalRange() {

  const end =
    startOfUtcDay(
      new Date()
    );


  end.setUTCDate(

    end.getUTCDate()

    -

    1
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

    includedState?.developer_name

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
       * CURRENT n'est accepté
       * qu'après vérification de l'état final.
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
  start,
  end
) {

  const fixtures =
    [];


  let page =
    1;


  let hasMore =
    true;


  while (
    hasMore
  ) {

    /*
     * Sécurité pagination.
     */

    if (
      page > 50
    ) {

      throw new Error(
        'Pagination Sportmonks anormalement longue.'
      );
    }


    const endpoint =

      `${API}/fixtures/between/${iso(
        start
      )}/${iso(
        end
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


  return fixtures;
}


// =====================================================
// TRANSFORMATION SPORTMONKS -> MATCHSCOPE
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


  const state =
    fixtureState(
      fixture
    );


  /*
   * On refuse tout match
   * non réellement terminé.
   */

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
       * On ne fabrique pas
       * une fausse heure de fin.
       */

      finished_at:
        null,

      updated_at:
        now
    }
  };
}


// =====================================================
// DÉCOUPAGE EN BATCHS
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
// DIAGNOSTIC
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
// HANDLER NETLIFY
// =====================================================

exports.handler =
  async event => {

    // -------------------------------------------------
    // POST UNIQUEMENT
    // -------------------------------------------------

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


    // -------------------------------------------------
    // AUTHENTIFICATION
    // -------------------------------------------------

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


    // -------------------------------------------------
    // SPORTMONKS TOKEN
    // -------------------------------------------------

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


    // -------------------------------------------------
    // MODE
    // -------------------------------------------------

    const mode =

      event
        ?.queryStringParameters
        ?.mode ===
      'seed'

        ? 'seed'

        : 'incremental';


    let range;


    let part =
      null;


    // -------------------------------------------------
    // SEED DÉCOUPÉ
    // -------------------------------------------------

    if (
      mode ===
      'seed'
    ) {

      part =
        Number(

          event
            ?.queryStringParameters
            ?.part
        );


      /*
       * Le seed sans numéro
       * de partie est interdit.
       */

      if (
        !Number.isInteger(
          part
        )

        ||

        part < 1

        ||

        part >
        SEED_PARTS
      ) {

        return jsonResponse(
          400,
          {

            success:
              false,

            error:
              'SEED_PART_REQUIRED',

            message:
              `Le seed doit être lancé partie par partie : part=1 à part=${SEED_PARTS}.`,

            example:
              '?mode=seed&part=1',

            seedParts:
              SEED_PARTS,

            daysPerPart:
              SEED_PART_DAYS
          }
        );
      }


      range =
        getSeedRange(
          part
        );


      if (
        !range
      ) {

        return jsonResponse(
          400,
          {

            success:
              false,

            error:
              'Plage seed invalide.'
          }
        );
      }

    } else {

      // ------------------------------------------------
      // MODE INCRÉMENTAL
      // ------------------------------------------------

      range =
        getIncrementalRange();
    }


    try {

      // ===============================================
      // 1. SPORTMONKS
      // ===============================================

      const rawFixtures =
        await fetchRange(

          token,

          range.start,

          range.end
        );


      // ===============================================
      // 2. DÉDUPLICATION
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
      // 3. TRANSFORMATION
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


      // ===============================================
      // 4. SUPABASE
      // ===============================================

      /*
       * Matches en premier
       * à cause de la clé étrangère.
       */

      await saveMatches(
        matches
      );


      await saveResults(
        results
      );


      // ===============================================
      // 5. COMPTAGE PAR LIGUE
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
      // 6. DIAGNOSTIC
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


      // ===============================================
      // 7. PROCHAINE PARTIE
      // ===============================================

      let nextPart =
        null;


      if (
        mode ===
        'seed'

        &&

        part <
        SEED_PARTS
      ) {

        nextPart =
          part + 1;
      }


      // ===============================================
      // 8. RÉPONSE
      // ===============================================

      return jsonResponse(
        200,
        {

          success:
            true,

          mode,

          part:
            mode ===
            'seed'

              ? part

              : null,

          seedParts:
            mode ===
            'seed'

              ? SEED_PARTS

              : null,

          nextPart,

          completed:
            mode ===
            'seed'

              ? part ===
                SEED_PARTS

              : true,

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

              ? (
                  part ===
                  SEED_PARTS

                    ? 'Dernière partie du seed MatchScope terminée.'

                    : `Seed MatchScope partie ${part}/${SEED_PARTS} terminé.`
                )

              : 'Mise à jour incrémentale MatchScope terminée.'
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

          mode,

          part,

          from:
            range
              ? iso(
                  range.start
                )
              : null,

          to:
            range
              ? iso(
                  range.end
                )
              : null,

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
