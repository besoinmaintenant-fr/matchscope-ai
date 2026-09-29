const {
  supabaseRequest
} = require('./lib/supabase');


const API =
  'https://api.sportmonks.com/v3/football';


const BATCH_SIZE =
  50;


const DB_PAGE_SIZE =
  1000;


const WRITE_BATCH_SIZE =
  500;


// =====================================================
// DONNÉES PRINCIPALES
// =====================================================

const CORE_INCLUDE = [

  'league',

  'season',

  'stage',

  'round',

  'group',

  'aggregate',

  'participants',

  'venue',

  'state',

  'scores',

  'metadata',

  'statistics.type',

  'events',

  'timeline',

  'periods',

  'formations',

  'weatherReport',

  'coaches',

  'referees',

  'sidelined.player',

  'sidelined.type',

  'sidelined.sideline',

  'lineups.player',

  'lineups.details.type'

].join(';');


// =====================================================
// GROUPES OPTIONNELS
//
// Si ton abonnement n'autorise pas un groupe,
// le reste du backfill continue.
// =====================================================

const OPTIONAL_GROUPS = [

  {
    key:
      'xg',

    include:
      'xGFixture;lineups.xGLineup'
  },


  {
    key:
      'expected',

    include:
      'expectedLineups.player;predictions'
  },


  {
    key:
      'odds',

    include:
      'odds.bookmaker'
  },


  {
    key:
      'context',

    include:
      'trends;prematchNews;postmatchNews'
  }

];


// =====================================================
// BODY / SÉCURITÉ
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

    expected

    &&

    received === expected
  );
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

        index +
        size
      )
    );
  }


  return output;
}


function relation(
  fixture,
  ...names
) {

  for (
    const name
    of names
  ) {

    if (
      fixture &&
      fixture[name] !==
      undefined
    ) {

      return fixture[
        name
      ];
    }
  }


  return null;
}


// =====================================================
// FUSION DES LINEUPS
//
// Certaines données arrivent dans
// lineups.details et d'autres dans
// lineups.xGLineup.
// =====================================================

function lineupKey(
  item
) {

  if (
    item?.id !== null &&
    item?.id !== undefined
  ) {

    return `id:${item.id}`;
  }


  return [

    'fallback',

    item?.fixture_id,

    item?.team_id,

    item?.player_id,

    item?.type_id

  ].join(':');
}


function mergeLineups(
  first = [],
  second = []
) {

  const map =
    new Map();


  for (
    const item
    of [
      ...array(first),
      ...array(second)
    ]
  ) {

    const key =
      lineupKey(
        item
      );


    const previous =
      map.get(
        key
      )
      ||
      {};


    map.set(

      key,

      {

        ...previous,

        ...item,


        player:

          item?.player

          ??

          previous?.player

          ??

          null,


        details:

          item?.details

          ??

          previous?.details

          ??

          [],


        expected:

          item?.expected

          ??

          previous?.expected

          ??

          previous?.xGLineup

          ??

          [],


        xGLineup:

          item?.xGLineup

          ??

          previous?.xGLineup

          ??

          previous?.expected

          ??

          []
      }
    );
  }


  return Array.from(
    map.values()
  );
}


function mergeFixture(
  base,
  extra
) {

  if (!extra) {

    return base;
  }


  const merged = {

    ...(base || {}),

    ...extra
  };


  merged.lineups =
    mergeLineups(

      base?.lineups,

      extra?.lineups
    );


  return merged;
}


// =====================================================
// SPORTMONKS MULTI FIXTURES
//
// 50 fixtures maximum par appel.
// =====================================================

async function fetchMulti(
  ids,
  token,
  include,
  label,
  required = false
) {

  const url =
    new URL(

      `${API}/fixtures/multi/${ids.join(',')}`
    );


  url.searchParams.set(
    'api_token',
    token
  );


  url.searchParams.set(
    'include',
    include
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

    const message =
      `${label}: réponse Sportmonks illisible.`;


    if (
      required
    ) {

      throw new Error(
        message
      );
    }


    return {

      ok:
        false,

      label,

      fixtures:
        [],

      error:
        message
    };
  }


  if (
    !response.ok
  ) {

    const message =

      payload?.message

      ||

      payload?.error

      ||

      `${label}: Sportmonks ${response.status}`;


    if (
      required
    ) {

      throw new Error(
        message
      );
    }


    return {

      ok:
        false,

      label,

      fixtures:
        [],

      error:
        message
    };
  }


  return {

    ok:
      true,

    label,

    fixtures:
      array(
        payload?.data
      ),

    error:
      null
  };
}


// =====================================================
// MATCHS À ENRICHIR
//
// On utilise les matchs dont nous avons déjà
// une composition confirmée.
// =====================================================

async function loadTargetFixtures() {

  const rows =
    [];


  let offset =
    0;


  while (
    true
  ) {

    const query =

      '?select='

      +

      [
        'sportmonks_fixture_id',
        'starting_at',
        'league_code',
        'lineups_confirmed'
      ].join(',')

      +

      '&league_code=in.(PL,BL,LL)'

      +

      '&lineups_confirmed=eq.true'

      +

      '&order=starting_at.desc'

      +

      `&limit=${DB_PAGE_SIZE}`

      +

      `&offset=${offset}`;


    const page =
      await supabaseRequest(
        'matches',
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
        'Réponse Supabase matches invalide.'
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


    if (
      offset >
      10000
    ) {

      throw new Error(
        'Pagination Supabase anormalement longue.'
      );
    }
  }


  return rows;
}


// =====================================================
// MATCHS DÉJÀ ENRICHIS
// =====================================================

async function loadExistingEnrichmentIds(
  ids
) {

  if (
    !ids.length
  ) {

    return new Set();
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

          `&sportmonks_fixture_id=in.(${ids.join(',')})`
      }
    );


  return new Set(

    array(
      rows
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
// UPSERT GÉNÉRIQUE
// =====================================================

async function upsertRows(
  table,
  conflict,
  rows
) {

  if (
    !rows.length
  ) {

    return;
  }


  for (
    const batch
    of chunks(
      rows,
      WRITE_BATCH_SIZE
    )
  ) {

    await supabaseRequest(
      table,
      {

        method:
          'POST',

        query:
          `?on_conflict=${encodeURIComponent(
            conflict
          )}`,

        body:
          batch,

        prefer:
          'resolution=merge-duplicates,return=minimal'
      }
    );
  }
}


// =====================================================
// STATISTIQUES ÉQUIPE
// =====================================================

function buildTeamStatistics(
  fixture
) {

  return array(
    fixture?.statistics
  )

    .map(
      item => {

        const id =
          numberOrNull(
            item?.id
          );


        if (
          id === null
        ) {

          return null;
        }


        return {

          sportmonks_stat_id:
            id,


          sportmonks_fixture_id:
            numberOrNull(
              fixture?.id
            ),


          team_id:
            numberOrNull(

              item?.participant_id

              ??

              item?.team_id
            ),


          type_id:
            numberOrNull(
              item?.type_id
            ),


          location:
            item?.location
            ||
            null,


          type_name:
            item?.type?.name
            ||
            null,


          type_code:
            item?.type?.code
            ||
            null,


          type_developer_name:
            item
              ?.type
              ?.developer_name
            ||
            null,


          value:
            item?.data
            ??
            null,


          raw_data:
            item
        };
      }
    )

    .filter(
      Boolean
    );
}


// =====================================================
// STATISTIQUES JOUEURS
// =====================================================

function buildPlayerStatistics(
  fixture
) {

  const rows =
    [];


  for (
    const lineup
    of array(
      fixture?.lineups
    )
  ) {

    for (
      const detail
      of array(
        lineup?.details
      )
    ) {

      const id =
        numberOrNull(
          detail?.id
        );


      if (
        id === null
      ) {

        continue;
      }


      rows.push({

        sportmonks_detail_id:
          id,


        sportmonks_fixture_id:
          numberOrNull(
            fixture?.id
          ),


        lineup_id:
          numberOrNull(

            detail?.lineup_id

            ??

            lineup?.id
          ),


        player_id:
          numberOrNull(

            detail?.player_id

            ??

            lineup?.player_id
          ),


        team_id:
          numberOrNull(

            detail?.team_id

            ??

            lineup?.team_id
          ),


        type_id:
          numberOrNull(
            detail?.type_id
          ),


        type_name:
          detail?.type?.name
          ||
          null,


        type_code:
          detail?.type?.code
          ||
          null,


        type_developer_name:
          detail
            ?.type
            ?.developer_name
          ||
          null,


        value:
          detail?.data
          ??
          null,


        raw_data:
          detail
      });
    }
  }


  return rows;
}


// =====================================================
// xG JOUEURS
// =====================================================

function buildPlayerXg(
  fixture
) {

  const rows =
    [];


  for (
    const lineup
    of array(
      fixture?.lineups
    )
  ) {

    const values =

      array(
        lineup?.expected
      ).length

        ? array(
            lineup.expected
          )

        : array(
            lineup?.xGLineup
          );


    for (
      const item
      of values
    ) {

      const id =
        numberOrNull(
          item?.id
        );


      if (
        id === null
      ) {

        continue;
      }


      rows.push({

        sportmonks_expected_id:
          id,


        sportmonks_fixture_id:
          numberOrNull(
            fixture?.id
          ),


        lineup_id:
          numberOrNull(

            item?.lineup_id

            ??

            lineup?.id
          ),


        player_id:
          numberOrNull(

            item?.player_id

            ??

            lineup?.player_id
          ),


        team_id:
          numberOrNull(

            item?.team_id

            ??

            lineup?.team_id
          ),


        type_id:
          numberOrNull(
            item?.type_id
          ),


        value:
          item?.data
          ??
          null,


        raw_data:
          item
      });
    }
  }


  return rows;
}


// =====================================================
// ÉVÉNEMENTS
// =====================================================

function buildEvents(
  fixture
) {

  return array(
    fixture?.events
  )

    .map(
      item => {

        const id =
          numberOrNull(
            item?.id
          );


        if (
          id === null
        ) {

          return null;
        }


        return {

          sportmonks_event_id:
            id,


          sportmonks_fixture_id:
            numberOrNull(
              fixture?.id
            ),


          period_id:
            numberOrNull(
              item?.period_id
            ),


          team_id:
            numberOrNull(

              item?.participant_id

              ??

              item?.team_id
            ),


          type_id:
            numberOrNull(
              item?.type_id
            ),


          player_id:
            numberOrNull(
              item?.player_id
            ),


          related_player_id:
            numberOrNull(
              item?.related_player_id
            ),


          minute:
            numberOrNull(
              item?.minute
            ),


          extra_minute:
            numberOrNull(
              item?.extra_minute
            ),


          result:
            item?.result
            ||
            null,


          info:
            item?.info
            ||
            null,


          addition:
            item?.addition
            ||
            null,


          raw_data:
            item
        };
      }
    )

    .filter(
      Boolean
    );
}


// =====================================================
// ABSENCES / BLESSURES / SUSPENSIONS
// =====================================================

function buildAbsences(
  fixture
) {

  return array(
    fixture?.sidelined
  )

    .map(
      item => {

        const id =
          numberOrNull(
            item?.id
          );


        if (
          id === null
        ) {

          return null;
        }


        return {

          sportmonks_sidelined_id:
            id,


          sportmonks_fixture_id:
            numberOrNull(
              fixture?.id
            ),


          player_id:
            numberOrNull(

              item?.player_id

              ??

              item?.player?.id
            ),


          team_id:
            numberOrNull(

              item?.team_id

              ??

              item?.participant_id
            ),


          type_id:
            numberOrNull(
              item?.type_id
            ),


          category:
            item?.category
            ||
            item?.sideline?.category
            ||
            null,


          type_name:
            item?.type?.name
            ||
            item
              ?.sideline
              ?.type
              ?.name
            ||
            null,


          start_date:
            item?.start_date
            ||
            item?.sideline?.start_date
            ||
            null,


          end_date:
            item?.end_date
            ||
            item?.sideline?.end_date
            ||
            null,


          games_missed:
            numberOrNull(

              item?.games_missed

              ??

              item?.sideline?.games_missed
            ),


          completed:

            typeof item?.completed ===
            'boolean'

              ? item.completed

              : (

                  typeof item
                    ?.sideline
                    ?.completed ===
                  'boolean'

                    ? item
                        .sideline
                        .completed

                    : null
                ),


          raw_data:
            item
        };
      }
    )

    .filter(
      Boolean
    );
}


// =====================================================
// LIGNE D'ENRICHISSEMENT GLOBALE
// =====================================================

function enrichmentRow(
  fixture,
  groupStatus
) {

  return {

    sportmonks_fixture_id:
      numberOrNull(
        fixture?.id
      ),


    captured_at:
      new Date()
        .toISOString(),


    data_stage:
      'HISTORICAL_POSTMATCH',


    core_available:
      true,


    xg_available:
      Boolean(
        groupStatus?.xg?.ok
      ),


    expected_available:
      Boolean(
        groupStatus
          ?.expected
          ?.ok
      ),


    odds_available:
      Boolean(
        groupStatus?.odds?.ok
      ),


    context_available:
      Boolean(
        groupStatus
          ?.context
          ?.ok
      ),


    league:
      relation(
        fixture,
        'league'
      ),


    season:
      relation(
        fixture,
        'season'
      ),


    stage:
      relation(
        fixture,
        'stage'
      ),


    round:
      relation(
        fixture,
        'round'
      ),


    fixture_group:
      relation(
        fixture,
        'group'
      ),


    aggregate_data:
      relation(
        fixture,
        'aggregate'
      ),


    participants:
      relation(
        fixture,
        'participants'
      )
      ||
      [],


    venue:
      relation(
        fixture,
        'venue'
      ),


    state:
      relation(
        fixture,
        'state'
      ),


    scores:
      relation(
        fixture,
        'scores'
      )
      ||
      [],


    metadata:
      relation(
        fixture,
        'metadata'
      )
      ||
      [],


    statistics:
      relation(
        fixture,
        'statistics'
      )
      ||
      [],


    events:
      relation(
        fixture,
        'events'
      )
      ||
      [],


    timeline:
      relation(
        fixture,
        'timeline'
      )
      ||
      [],


    periods:
      relation(
        fixture,
        'periods'
      )
      ||
      [],


    formations:
      relation(
        fixture,
        'formations'
      )
      ||
      [],


    weather_report:
      relation(
        fixture,
        'weatherreport',
        'weatherReport'
      ),


    coaches:
      relation(
        fixture,
        'coaches'
      )
      ||
      [],


    referees:
      relation(
        fixture,
        'referees'
      )
      ||
      [],


    sidelined:
      relation(
        fixture,
        'sidelined'
      )
      ||
      [],


    expected_lineups:
      relation(
        fixture,
        'expectedlineups',
        'expectedLineups'
      )
      ||
      [],


    xg_fixture:
      relation(
        fixture,
        'expected',
        'xGFixture'
      )
      ||
      [],


    odds:
      relation(
        fixture,
        'odds'
      )
      ||
      [],


    predictions:
      relation(
        fixture,
        'predictions'
      )
      ||
      [],


    trends:
      relation(
        fixture,
        'trends'
      )
      ||
      [],


    prematch_news:
      relation(
        fixture,
        'prematchnews',
        'prematchNews'
      )
      ||
      [],


    postmatch_news:
      relation(
        fixture,
        'postmatchnews',
        'postmatchNews'
      )
      ||
      [],


    extra_status:
      groupStatus,


    raw_fixture:
      fixture,


    updated_at:
      new Date()
        .toISOString()
  };
}


// =====================================================
// ENRICHISSEMENT D'UN LOT
// =====================================================

async function enrichBatch(
  ids,
  token
) {

  const core =
    await fetchMulti(

      ids,

      token,

      CORE_INCLUDE,

      'core',

      true
    );


  const optionalResults =
    [];


  for (
    const group
    of OPTIONAL_GROUPS
  ) {

    optionalResults.push(

      await fetchMulti(

        ids,

        token,

        group.include,

        group.key,

        false
      )
    );
  }


  const fixtureMap =
    new Map();


  for (
    const fixture
    of core.fixtures
  ) {

    fixtureMap.set(

      Number(
        fixture.id
      ),

      fixture
    );
  }


  const groupStatus =
    {};


  for (
    const result
    of optionalResults
  ) {

    groupStatus[
      result.label
    ] = {

      ok:
        result.ok,

      error:
        result.error
    };


    if (
      !result.ok
    ) {

      continue;
    }


    for (
      const fixture
      of result.fixtures
    ) {

      const id =
        Number(
          fixture.id
        );


      const current =
        fixtureMap.get(
          id
        )
        ||
        {
          id
        };


      fixtureMap.set(

        id,

        mergeFixture(
          current,
          fixture
        )
      );
    }
  }


  const fixtures =
    Array.from(
      fixtureMap.values()
    );


  const enrichment =
    [];


  const teamStats =
    [];


  const playerStats =
    [];


  const playerXg =
    [];


  const events =
    [];


  const absences =
    [];


  for (
    const fixture
    of fixtures
  ) {

    enrichment.push(

      enrichmentRow(
        fixture,
        groupStatus
      )
    );


    teamStats.push(
      ...buildTeamStatistics(
        fixture
      )
    );


    playerStats.push(
      ...buildPlayerStatistics(
        fixture
      )
    );


    playerXg.push(
      ...buildPlayerXg(
        fixture
      )
    );


    events.push(
      ...buildEvents(
        fixture
      )
    );


    absences.push(
      ...buildAbsences(
        fixture
      )
    );
  }


  await upsertRows(

    'fixture_enrichment',

    'sportmonks_fixture_id',

    enrichment
  );


  await upsertRows(

    'team_match_statistics',

    'sportmonks_stat_id',

    teamStats
  );


  await upsertRows(

    'player_match_statistics',

    'sportmonks_detail_id',

    playerStats
  );


  await upsertRows(

    'player_match_xg',

    'sportmonks_expected_id',

    playerXg
  );


  await upsertRows(

    'fixture_events',

    'sportmonks_event_id',

    events
  );


  await upsertRows(

    'fixture_absences',

    'sportmonks_sidelined_id',

    absences
  );


  return {

    fixtures:
      fixtures.length,

    teamStats:
      teamStats.length,

    playerStats:
      playerStats.length,

    playerXg:
      playerXg.length,

    events:
      events.length,

    absences:
      absences.length,

    groupStatus
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
        'enrich-history : POST requis.'
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
        'enrich-history : accès non autorisé.'
      );

      return;
    }


    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (
      !token
    ) {

      console.error(
        'enrich-history : SPORTMONKS_API_TOKEN absent.'
      );

      return;
    }


    const force =
      body?.force ===
      true;


    try {

      const targets =
        await loadTargetFixtures();


      const ids =
        targets

          .map(
            row =>
              Number(
                row
                  .sportmonks_fixture_id
              )
          )

          .filter(
            Number.isFinite
          );


      const batches =
        chunks(
          ids,
          BATCH_SIZE
        );


      const totals = {

        targetFixtures:
          ids.length,

        skippedExisting:
          0,

        enrichedFixtures:
          0,

        teamStats:
          0,

        playerStats:
          0,

        playerXg:
          0,

        events:
          0,

        absences:
          0,

        batchErrors:
          []
      };


      for (
        let index = 0;
        index < batches.length;
        index += 1
      ) {

        const batch =
          batches[
            index
          ];


        let work =
          batch;


        if (
          !force
        ) {

          const existing =
            await loadExistingEnrichmentIds(
              batch
            );


          totals.skippedExisting +=
            existing.size;


          work =
            batch.filter(
              id =>
                !existing.has(
                  id
                )
            );
        }


        if (
          !work.length
        ) {

          continue;
        }


        try {

          const result =
            await enrichBatch(
              work,
              token
            );


          totals.enrichedFixtures +=
            result.fixtures;


          totals.teamStats +=
            result.teamStats;


          totals.playerStats +=
            result.playerStats;


          totals.playerXg +=
            result.playerXg;


          totals.events +=
            result.events;


          totals.absences +=
            result.absences;


          console.log(

            JSON.stringify({

              job:
                'enrich-history-background',

              batch:
                index + 1,

              batches:
                batches.length,

              requested:
                work.length,

              result
            })
          );


        } catch (
          error
        ) {

          totals
            .batchErrors
            .push({

              batch:
                index + 1,

              ids:
                work,

              error:
                error?.message
                ||
                String(error)
            });
        }
      }


      console.log(

        JSON.stringify(
          {

            job:
              'enrich-history-background',

            finishedAt:
              new Date()
                .toISOString(),

            force,

            ...totals
          },
          null,
          2
        )
      );


    } catch (
      error
    ) {

      console.error(

        'enrich-history fatal :',

        error?.message
        ||
        error
      );
    }
  };
