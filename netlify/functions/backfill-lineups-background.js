const {
  supabaseRequest
} = require('./lib/supabase');


const {
  saveLineups,
  saveMatch,
  lineupStatus
} = require('./lib/memory');


const API =
  'https://api.sportmonks.com/v3/football';


const LEAGUES = {

  8: {
    code: 'PL',
    name: 'Premier League'
  },

  82: {
    code: 'BL',
    name: 'Bundesliga'
  },

  564: {
    code: 'LL',
    name: 'La Liga'
  }
};


const LEAGUE_IDS =
  Object.keys(
    LEAGUES
  );


const MATCHES_PER_TEAM =
  10;


// On remonte suffisamment loin pour
// couvrir les 10 derniers matchs,
// y compris avec trêves / intersaison.
const BACKFILL_DAYS =
  180;


// Sportmonks : découpage < 100 jours.
const CHUNK_DAYS =
  90;


const PAGE_SIZE =
  50;


const FINAL_STATE_IDS =
  new Set([
    5,
    7,
    8
  ]);


// =====================================================
// OUTILS
// =====================================================

function parseBody(
  event
) {

  try {

    return JSON.parse(
      event?.body ||
      '{}'
    );

  } catch {

    return {};
  }
}


function authorized(
  body
) {

  const expected =
    process
      .env
      .MATCHSCOPE_SYNC_SECRET;


  const received =
    typeof body?.secret ===
    'string'

      ? body.secret.trim()

      : '';


  return Boolean(
    expected &&
    received === expected
  );
}


function startUtcDay(
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


function addDays(
  value,
  days
) {

  const date =
    new Date(
      value
    );


  date.setUTCDate(
    date.getUTCDate()
    +
    days
  );


  return date;
}


function isoDate(
  date
) {

  return date
    .toISOString()
    .slice(
      0,
      10
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


  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      .test(
        raw
      )
  ) {

    return new Date(
      raw.replace(
        ' ',
        'T'
      ) + 'Z'
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


function getTeam(
  participants,
  location
) {

  return (
    participants.find(
      team =>
        team
          ?.meta
          ?.location ===
        location
    )
    ||
    null
  );
}


// =====================================================
// PLAGES DE DATES
// =====================================================

function buildRanges() {

  const end =
    startUtcDay();


  end.setUTCDate(
    end.getUTCDate() - 1
  );


  const start =
    addDays(
      end,
      -(BACKFILL_DAYS - 1)
    );


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
      rangeEnd >
      end
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
// SPORTMONKS
//
// On récupère directement les lineups dans
// les pages de fixtures afin d'éviter
// un appel API séparé pour chaque match.
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

    if (
      page >
      50
    ) {

      throw new Error(
        'Pagination Sportmonks anormalement longue.'
      );
    }


    const url =
      new URL(

        `${API}/fixtures/between/${isoDate(
          start
        )}/${isoDate(
          end
        )}`
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

      [
        'league',
        'participants',
        'venue',
        'state',
        'lineups.player',
        'lineups.position',
        'lineups.detailedPosition',
        'formations'
      ].join(';')
    );


    url.searchParams.set(
      'per_page',
      String(
        PAGE_SIZE
      )
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


    let payload;


    try {

      payload =
        JSON.parse(
          raw
        );

    } catch {

      throw new Error(
        'Réponse Sportmonks illisible.'
      );
    }


    if (
      !response.ok
    ) {

      throw new Error(

        payload?.message

        ||

        payload?.error

        ||

        `Sportmonks ${response.status}`
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


    page +=
      1;
  }


  return fixtures;
}


// =====================================================
// FIXTURES EXPLOITABLES
// =====================================================

function validHistoricalFixture(
  fixture
) {

  const leagueId =
    Number(
      fixture?.league_id
    );


  if (
    !LEAGUES[
      leagueId
    ]
  ) {

    return false;
  }


  if (
    !FINAL_STATE_IDS.has(
      Number(
        fixture?.state_id
      )
    )
  ) {

    return false;
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

    return false;
  }


  const kickoff =
    parseKickoff(
      fixture?.starting_at
    );


  if (!kickoff) {

    return false;
  }


  const lineup =
    lineupStatus(
      fixture
    );


  return lineup.official;
}


// =====================================================
// SÉLECTION : 10 MATCHS PAR ÉQUIPE
// =====================================================

function selectRecentFixtures(
  fixtures
) {

  const chronological =
    [...fixtures]

      .filter(
        validHistoricalFixture
      )

      .sort(
        (
          first,
          second
        ) => {

          const a =
            parseKickoff(
              first.starting_at
            )
              ?.getTime()
            ||
            0;


          const b =
            parseKickoff(
              second.starting_at
            )
              ?.getTime()
            ||
            0;


          return (
            b - a
          );
        }
      );


  const teamCounts =
    new Map();


  const selected =
    [];


  const selectedIds =
    new Set();


  for (
    const fixture
    of chronological
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

      continue;
    }


    const homeKey =
      `${fixture.league_id}:${home.id}`;


    const awayKey =
      `${fixture.league_id}:${away.id}`;


    const homeCount =
      teamCounts.get(
        homeKey
      )
      ||
      0;


    const awayCount =
      teamCounts.get(
        awayKey
      )
      ||
      0;


    /*
     * On conserve le match tant qu'au moins
     * une des deux équipes n'a pas encore
     * ses 10 références.
     */

    if (
      homeCount >=
      MATCHES_PER_TEAM

      &&

      awayCount >=
      MATCHES_PER_TEAM
    ) {

      continue;
    }


    const fixtureId =
      Number(
        fixture.id
      );


    if (
      selectedIds.has(
        fixtureId
      )
    ) {

      continue;
    }


    selectedIds.add(
      fixtureId
    );


    selected.push(
      fixture
    );


    if (
      homeCount <
      MATCHES_PER_TEAM
    ) {

      teamCounts.set(
        homeKey,
        homeCount + 1
      );
    }


    if (
      awayCount <
      MATCHES_PER_TEAM
    ) {

      teamCounts.set(
        awayKey,
        awayCount + 1
      );
    }
  }


  return {

    fixtures:
      selected,

    teamCounts
  };
}


// =====================================================
// MATCHS DÉJÀ ENREGISTRÉS
// =====================================================

async function loadAlreadyConfirmed(
  fixtureIds
) {

  if (
    !fixtureIds.length
  ) {

    return new Set();
  }


  const ids =
    fixtureIds

      .map(
        Number
      )

      .filter(
        Number.isFinite
      );


  if (
    !ids.length
  ) {

    return new Set();
  }


  const query =

    '?select='

    +

    [
      'sportmonks_fixture_id',
      'lineups_confirmed'
    ].join(',')

    +

    `&sportmonks_fixture_id=in.(${ids.join(',')})`;


  const rows =
    await supabaseRequest(
      'matches',
      {

        method:
          'GET',

        query
      }
    );


  return new Set(

    (
      Array.isArray(
        rows
      )

        ? rows

        : []
    )

      .filter(
        row =>
          row.lineups_confirmed ===
          true
      )

      .map(
        row =>
          Number(
            row.sportmonks_fixture_id
          )
      )

      .filter(
        Number.isFinite
      )
  );
}


// =====================================================
// MARQUER LE MATCH COMME CONFIRMÉ
//
// On évite de remplacer inutilement tout le raw_data
// historique quand le match existe déjà.
// =====================================================

async function markConfirmed(
  fixture
) {

  const fixtureId =
    Number(
      fixture.id
    );


  const updated =
    await supabaseRequest(
      'matches',
      {

        method:
          'PATCH',

        query:
          `?sportmonks_fixture_id=eq.${encodeURIComponent(
            fixtureId
          )}`,

        body: {

          lineups_confirmed:
            true,

          updated_at:
            new Date()
              .toISOString()
        },

        prefer:
          'return=representation'
      }
    );


  /*
   * Sécurité :
   * si le match n'existe pas encore dans Supabase,
   * on le crée avec le helper existant.
   */

  if (
    !Array.isArray(
      updated
    )

    ||

    !updated.length
  ) {

    await saveMatch(
      fixture,
      true
    );
  }
}


// =====================================================
// SAUVEGARDE D'UNE COMPOSITION
// =====================================================

async function storeFixture(
  fixture
) {

  const lineup =
    lineupStatus(
      fixture
    );


  if (
    !lineup.official
  ) {

    return {

      saved:
        false,

      reason:
        'NO_OFFICIAL_LINEUP'
    };
  }


  await markConfirmed(
    fixture
  );


  const rows =
    await saveLineups(
      fixture
    );


  return {

    saved:
      true,

    starters:
      lineup.starters.length,

    rows:
      Array.isArray(
        rows
      )

        ? rows.length

        : null
  };
}


// =====================================================
// BACKGROUND FUNCTION
// =====================================================

exports.handler =
  async event => {

    if (
      event.httpMethod !==
      'POST'
    ) {

      console.log(
        'backfill-lineups : POST requis.'
      );

      return;
    }


    const body =
      parseBody(
        event
      );


    if (
      !authorized(
        body
      )
    ) {

      console.error(
        'backfill-lineups : accès non autorisé.'
      );

      return;
    }


    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      console.error(
        'backfill-lineups : SPORTMONKS_API_TOKEN absent.'
      );

      return;
    }


    try {

      const ranges =
        buildRanges();


      const allFixtures =
        [];


      // ---------------------------------------------
      // 1. SPORTMONKS
      // ---------------------------------------------

      for (
        const range
        of ranges
      ) {

        const fixtures =
          await fetchRange(

            token,

            range.start,

            range.end
          );


        allFixtures.push(
          ...fixtures
        );
      }


      // ---------------------------------------------
      // 2. DÉDOUBLONNAGE
      // ---------------------------------------------

      const fixtureMap =
        new Map();


      allFixtures.forEach(
        fixture => {

          const id =
            Number(
              fixture?.id
            );


          if (
            Number.isFinite(
              id
            )
          ) {

            fixtureMap.set(
              id,
              fixture
            );
          }
        }
      );


      const uniqueFixtures =
        Array.from(
          fixtureMap.values()
        );


      // ---------------------------------------------
      // 3. 10 MATCHS PAR ÉQUIPE
      // ---------------------------------------------

      const selection =
        selectRecentFixtures(
          uniqueFixtures
        );


      const selectedFixtures =
        selection.fixtures;


      const selectedIds =
        selectedFixtures.map(
          fixture =>
            Number(
              fixture.id
            )
        );


      // ---------------------------------------------
      // 4. DÉJÀ PRÉSENTS ?
      // ---------------------------------------------

      const alreadyConfirmed =
        await loadAlreadyConfirmed(
          selectedIds
        );


      const remaining =
        selectedFixtures.filter(
          fixture =>

            !alreadyConfirmed.has(
              Number(
                fixture.id
              )
            )
        );


      // ---------------------------------------------
      // 5. SAUVEGARDE
      // ---------------------------------------------

      let saved =
        0;


      let skipped =
        alreadyConfirmed.size;


      let failed =
        0;


      let lineupRows =
        0;


      const errors =
        [];


      for (
        const fixture
        of remaining
      ) {

        try {

          const result =
            await storeFixture(
              fixture
            );


          if (
            result.saved
          ) {

            saved +=
              1;


            if (
              Number.isFinite(
                Number(
                  result.rows
                )
              )
            ) {

              lineupRows +=
                Number(
                  result.rows
                );
            }

          } else {

            skipped +=
              1;
          }


        } catch (
          error
        ) {

          failed +=
            1;


          errors.push({

            fixtureId:
              fixture?.id
              ||
              null,

            error:
              error?.message
              ||
              String(error)
          });
        }
      }


      // ---------------------------------------------
      // 6. RÉSUMÉ
      // ---------------------------------------------

      const leagueCounts =
        {};


      selectedFixtures.forEach(
        fixture => {

          const code =
            LEAGUES[
              Number(
                fixture.league_id
              )
            ]
              ?.code
            ||
            'UNKNOWN';


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


      console.log(

        JSON.stringify(
          {

            function:
              'backfill-lineups-background',

            finishedAt:
              new Date()
                .toISOString(),

            backfillDays:
              BACKFILL_DAYS,

            matchesPerTeam:
              MATCHES_PER_TEAM,

            sportmonksFixtures:
              uniqueFixtures.length,

            selectedFixtures:
              selectedFixtures.length,

            leagues:
              leagueCounts,

            alreadyConfirmed:
              alreadyConfirmed.size,

            saved,

            skipped,

            failed,

            lineupRows,

            errors:
              errors.slice(
                0,
                20
              )
          },
          null,
          2
        )
      );


    } catch (
      error
    ) {

      console.error(
        'backfill-lineups fatal :',
        error?.message
        ||
        error
      );
    }
  };
