const {
  supabaseRequest
} = require('./lib/supabase');

const {
  saveMatch,
  saveLineups,
  lineupStatus
} = require('./lib/memory');

const API =
  'https://api.sportmonks.com/v3/football';


const LEAGUE_IDS = [
  8,
  82,
  564
];


const LEAGUE_CODES = {
  8: 'PL',
  82: 'BL',
  564: 'LL'
};


const LOOKAHEAD_MINUTES =
  60;


const AFTER_KICKOFF_MINUTES =
  30;


// =====================================================
// OUTILS
// =====================================================

function array(value) {

  return Array.isArray(value)
    ? value
    : [];
}


function isoDate(date) {

  return date
    .toISOString()
    .slice(0, 10);
}


function parseKickoff(value) {

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
      ) + 'Z'
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


function numberOrNull(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {

    return null;
  }


  const number =
    Number(value);


  return Number.isFinite(number)
    ? number
    : null;
}


function getTeam(
  fixture,
  location
) {

  return array(
    fixture?.participants
  ).find(
    participant =>
      participant
        ?.meta
        ?.location === location
  ) || null;
}


function firstDefined(
  object,
  names
) {

  for (
    const name
    of names
  ) {

    if (
      object?.[name] !==
      undefined
    ) {

      return object[name];
    }
  }


  return null;
}


function coverage(values) {

  const list =
    Object.values(values);


  if (!list.length) {
    return 0;
  }


  const available =
    list.filter(
      value =>
        value !== null &&
        value !== undefined
    ).length;


  return Math.round(
    (
      available /
      list.length
    ) * 1000
  ) / 10;
}


// =====================================================
// LISTE LÉGÈRE
// =====================================================

async function fetchFixtureList(
  token
) {

  const now =
    new Date();


  const tomorrow =
    new Date(
      now.getTime() +
      24 * 60 * 60 * 1000
    );


  const fixtures =
    [];


  let page =
    1;


  let hasMore =
    true;


  while (
    hasMore &&
    page <= 10
  ) {

    const url =
      new URL(
        `${API}/fixtures/between/${isoDate(
          now
        )}/${isoDate(
          tomorrow
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
      'league;participants;state'
    );


    url.searchParams.set(
      'per_page',
      '100'
    );


    url.searchParams.set(
      'page',
      String(page)
    );


    const response =
      await fetch(url);


    const raw =
      await response.text();


    let payload;


    try {

      payload =
        JSON.parse(raw);

    } catch {

      throw new Error(
        'Réponse Sportmonks illisible.'
      );
    }


    if (!response.ok) {

      throw new Error(
        payload?.message ||
        payload?.error ||
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


    page += 1;
  }


  return fixtures;
}


// =====================================================
// MATCH PROCHE DU COUP D'ENVOI
// =====================================================

function isCandidate(
  fixture
) {

  const kickoff =
    parseKickoff(
      fixture?.starting_at
    );


  if (!kickoff) {
    return false;
  }


  const differenceMinutes =
    (
      kickoff.getTime() -
      Date.now()
    )
    /
    60000;


  return (
    differenceMinutes <=
    LOOKAHEAD_MINUTES

    &&

    differenceMinutes >=
    -AFTER_KICKOFF_MINUTES
  );
}


// =====================================================
// XI DÉJÀ CONFIRMÉS
// =====================================================

async function getConfirmedFixtureIds(
  fixtureIds
) {

  if (!fixtureIds.length) {
    return new Set();
  }


  const cleanIds =
    fixtureIds
      .map(numberOrNull)
      .filter(
        value =>
          value !== null
      );


  if (!cleanIds.length) {
    return new Set();
  }


  const rows =
    await supabaseRequest(
      'matches',
      {

        method:
          'GET',

        query:
          '?select='
          +
          [
            'sportmonks_fixture_id',
            'lineups_confirmed'
          ].join(',')
          +
          `&sportmonks_fixture_id=in.(${cleanIds.join(',')})`
      }
    );


  return new Set(
    array(rows)

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
// SNAPSHOT FINAL DÉJÀ PRÉSENT
// =====================================================

async function getFinalSnapshotIds(
  fixtureIds
) {

  if (!fixtureIds.length) {
    return new Set();
  }


  const cleanIds =
    fixtureIds
      .map(numberOrNull)
      .filter(
        value =>
          value !== null
      );


  if (!cleanIds.length) {
    return new Set();
  }


  const rows =
    await supabaseRequest(
      'prematch_snapshots',
      {

        method:
          'GET',

        query:
          '?select=sportmonks_fixture_id'
          +
          '&snapshot_stage=eq.FINAL'
          +
          `&sportmonks_fixture_id=in.(${cleanIds.join(',')})`
      }
    );


  return new Set(
    array(rows)

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
// MATCH DÉTAILLÉ CRITIQUE
//
// IMPORTANT :
// aucune cote dans cette requête.
//
// Une erreur sur les odds ne pourra donc jamais
// empêcher la récupération des XI officiels.
// =====================================================

async function fetchFixtureDetails(
  fixtureId,
  token
) {

  const url =
    new URL(
      `${API}/fixtures/${encodeURIComponent(
        fixtureId
      )}`
    );


  url.searchParams.set(
    'api_token',
    token
  );


  url.searchParams.set(
    'include',
    [
      'league',
      'participants',
      'venue',
      'state',
      'metadata',
      'lineups.player',
      'formations',
      'weatherReport',
      'sidelined.sideline',
      'statistics.type'
    ].join(';')
  );


  const response =
    await fetch(url);


  const raw =
    await response.text();


  let payload;


  try {

    payload =
      JSON.parse(raw);

  } catch {

    throw new Error(
      'Réponse détaillée Sportmonks invalide.'
    );
  }


  if (!response.ok) {

    throw new Error(
      payload?.message ||
      payload?.error ||
      `Sportmonks ${response.status}`
    );
  }


  if (!payload?.data) {

    throw new Error(
      'Match Sportmonks introuvable.'
    );
  }


  return payload.data;
}


// =====================================================
// COTES OPTIONNELLES
//
// Si elles échouent :
// - les XI restent enregistrés
// - le snapshot FINAL reste enregistré
// - odds = null
// =====================================================

async function fetchOptionalOdds(
  fixtureId,
  token
) {

  const url =
    new URL(
      `${API}/fixtures/${encodeURIComponent(
        fixtureId
      )}`
    );


  url.searchParams.set(
    'api_token',
    token
  );


  url.searchParams.set(
    'include',
    'odds.bookmaker'
  );


  const response =
    await fetch(url);


  const raw =
    await response.text();


  let payload =
    null;


  try {

    payload =
      JSON.parse(raw);

  } catch {

    payload =
      null;
  }


  if (!response.ok) {

    return {

      ok:
        false,

      status:
        response.status,

      error:
        payload?.message ||
        payload?.error ||
        `HTTP ${response.status}`,

      odds:
        null
    };
  }


  return {

    ok:
      true,

    status:
      response.status,

    error:
      null,

    odds:
      firstDefined(
        payload?.data,
        [
          'odds',
          'Odds'
        ]
      )
  };
}


// =====================================================
// CONSTRUCTION SNAPSHOT FINAL
// =====================================================

function buildFinalSnapshot(
  fixture,
  oddsResult
) {

  const kickoff =
    parseKickoff(
      fixture?.starting_at
    );


  if (!kickoff) {

    throw new Error(
      'Kickoff invalide pour snapshot FINAL.'
    );
  }


  const lineup =
    lineupStatus(
      fixture
    );


  if (!lineup.official) {

    throw new Error(
      'Impossible de créer FINAL sans XI officiels.'
    );
  }


  const leagueId =
    numberOrNull(
      fixture?.league_id
    );


  const home =
    getTeam(
      fixture,
      'home'
    );


  const away =
    getTeam(
      fixture,
      'away'
    );


  const venue =
    firstDefined(
      fixture,
      ['venue']
    );


  const metadata =
    firstDefined(
      fixture,
      ['metadata']
    );


  const weather =
    firstDefined(
      fixture,
      [
        'weatherreport',
        'weatherReport',
        'weather_report'
      ]
    );


  const formations =
    firstDefined(
      fixture,
      ['formations']
    );


  const sidelined =
    firstDefined(
      fixture,
      ['sidelined']
    );


  const lineups =
    firstDefined(
      fixture,
      ['lineups']
    );


  const statistics =
    firstDefined(
      fixture,
      ['statistics']
    );


  const odds =
    oddsResult?.ok
      ? oddsResult.odds
      : null;


  const capturedAt =
    new Date()
      .toISOString();


  const minutesToKickoff =
    Math.round(
      (
        kickoff.getTime() -
        Date.now()
      )
      /
      60000
    );


  const dataCoverage =
    coverage({
      venue,
      metadata,
      weather,
      formations,
      sidelined,
      lineups,
      statistics,
      odds
    });


  return {

    sportmonks_fixture_id:
      Number(
        fixture.id
      ),

    league_code:
      LEAGUE_CODES[
        leagueId
      ] || null,

    snapshot_stage:
      'FINAL',

    captured_at:
      capturedAt,

    kickoff_at:
      kickoff.toISOString(),

    minutes_to_kickoff:
      minutesToKickoff,

    lineups_official:
      true,

    starters_found:
      lineup.starters.length,

    data_coverage:
      dataCoverage,

    home_team_id:
      numberOrNull(
        home?.id
      ),

    away_team_id:
      numberOrNull(
        away?.id
      ),

    venue,

    state:
      fixture?.state ?? null,

    metadata,

    weather_report:
      weather,

    formations,

    sidelined,

    lineups,

    statistics,

    odds,

    optional_status: {

      source:
        'collect-lineups',

      final_snapshot:
        true,

      odds: {

        attempted:
          true,

        ok:
          oddsResult?.ok ===
          true,

        http_status:
          oddsResult?.status ??
          null,

        error:
          oddsResult?.error ??
          null
      },

      captured_at:
        capturedAt
    },

    raw_fixture: {

      ...fixture,

      snapshot_odds:
        odds
    },

    updated_at:
      capturedAt
  };
}


// =====================================================
// SAUVEGARDE FINAL IMMUTABLE
// =====================================================

async function saveFinalSnapshot(
  fixture,
  oddsResult
) {

  const row =
    buildFinalSnapshot(
      fixture,
      oddsResult
    );


  const saved =
    await supabaseRequest(
      'prematch_snapshots',
      {

        method:
          'POST',

        query:
          '?on_conflict=sportmonks_fixture_id,snapshot_stage',

        body:
          row,

        prefer:
          'resolution=ignore-duplicates,return=representation'
      }
    );


  return {

    saved:
      Array.isArray(saved)
      &&
      saved.length >
      0,

    snapshot:
      Array.isArray(saved)
        ? saved[0] || null
        : saved
  };
}


// =====================================================
// TRAITEMENT D'UN MATCH
// =====================================================

async function processFixture(
  lightFixture,
  token
) {

  const fixtureId =
    Number(
      lightFixture?.id
    );


  if (
    !Number.isFinite(
      fixtureId
    )
  ) {

    return {

      fixtureId:
        null,

      status:
        'INVALID_FIXTURE'
    };
  }


  // ---------------------------------------------------
  // 1. APPEL CRITIQUE : XI
  // ---------------------------------------------------

  const fixture =
    await fetchFixtureDetails(
      fixtureId,
      token
    );


  const lineup =
    lineupStatus(
      fixture
    );


  // ---------------------------------------------------
  // 2. XI PAS ENCORE OFFICIELS
  // ---------------------------------------------------

  if (!lineup.official) {

    return {

      fixtureId,

      status:
        'WAITING',

      startersFound:
        lineup.starters.length
    };
  }


  // ---------------------------------------------------
  // 3. XI OFFICIELS : SAUVEGARDE IMMÉDIATE
  // ---------------------------------------------------

  await saveMatch(
    fixture,
    true
  );


  const savedLineups =
    await saveLineups(
      fixture
    );


  // ---------------------------------------------------
  // 4. COTES OPTIONNELLES
  //
  // Leur échec ne peut plus bloquer les XI.
  // ---------------------------------------------------

  let oddsResult =
    {

      ok:
        false,

      status:
        null,

      error:
        'NOT_ATTEMPTED',

      odds:
        null
    };


  try {

    oddsResult =
      await fetchOptionalOdds(
        fixtureId,
        token
      );

  } catch (error) {

    oddsResult = {

      ok:
        false,

      status:
        null,

      error:
        error?.message ||
        String(error),

      odds:
        null
    };
  }


  // ---------------------------------------------------
  // 5. SNAPSHOT FINAL
  // ---------------------------------------------------

  const finalSnapshot =
    await saveFinalSnapshot(
      fixture,
      oddsResult
    );


  return {

    fixtureId,

    status:
      'SAVED',

    startersFound:
      lineup.starters.length,

    lineupRows:
      Array.isArray(
        savedLineups
      )
        ? savedLineups.length
        : null,

    finalSnapshotSaved:
      finalSnapshot.saved,

    oddsAvailable:
      oddsResult.ok ===
      true
  };
}


// =====================================================
// HANDLER
// =====================================================

exports.handler =
  async () => {

    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      return {

        statusCode:
          500,

        body:
          JSON.stringify({

            success:
              false,

            error:
              'SPORTMONKS_API_TOKEN absent.'
          })
      };
    }


    try {

      // -------------------------------------------------
      // A. LISTE LÉGÈRE
      // -------------------------------------------------

      const fixtures =
        await fetchFixtureList(
          token
        );


      // -------------------------------------------------
      // B. MATCHS PROCHES
      // -------------------------------------------------

      const candidates =
        fixtures.filter(
          isCandidate
        );


      const fixtureIds =
        candidates

          .map(
            fixture =>
              Number(
                fixture.id
              )
          )

          .filter(
            Number.isFinite
          );


      // -------------------------------------------------
      // C. MÉMOIRE
      // -------------------------------------------------

      const [
        confirmedIds,
        finalSnapshotIds
      ] =
        await Promise.all([

          getConfirmedFixtureIds(
            fixtureIds
          ),

          getFinalSnapshotIds(
            fixtureIds
          )
        ]);


      /*
       * Match complet seulement si :
       *
       * - XI sauvegardés
       * - snapshot FINAL sauvegardé
       */
      const completed =
        new Set(
          fixtureIds.filter(
            fixtureId =>

              confirmedIds.has(
                fixtureId
              )

              &&

              finalSnapshotIds.has(
                fixtureId
              )
          )
        );


      const unresolved =
        candidates.filter(
          fixture =>

            !completed.has(
              Number(
                fixture.id
              )
            )
        );


      const results =
        [];


      // -------------------------------------------------
      // D. DÉJÀ COMPLETS
      // -------------------------------------------------

      candidates.forEach(
        fixture => {

          const fixtureId =
            Number(
              fixture.id
            );


          if (
            completed.has(
              fixtureId
            )
          ) {

            results.push({

              fixtureId,

              status:
                'ALREADY_COMPLETE_SKIPPED'
            });
          }
        }
      );


      // -------------------------------------------------
      // E. RESTANTS
      // -------------------------------------------------

      for (
        const fixture
        of unresolved
      ) {

        try {

          const result =
            await processFixture(
              fixture,
              token
            );


          results.push(
            result
          );

        } catch (error) {

          results.push({

            fixtureId:
              fixture?.id || null,

            status:
              'ERROR',

            error:
              error?.message ||
              String(error)
          });
        }
      }


      // -------------------------------------------------
      // F. RÉSUMÉ
      // -------------------------------------------------

      const summary = {

        success:
          true,

        function:
          'collect-lineups',

        checkedAt:
          new Date()
            .toISOString(),

        fixturesReceived:
          fixtures.length,

        candidates:
          candidates.length,

        alreadyComplete:
          completed.size,

        checkedForLineups:
          unresolved.length,

        saved:
          results.filter(
            item =>
              item.status ===
              'SAVED'
          ).length,

        waiting:
          results.filter(
            item =>
              item.status ===
              'WAITING'
          ).length,

        errors:
          results.filter(
            item =>
              item.status ===
              'ERROR'
          ).length,

        finalSnapshotsSaved:
          results.filter(
            item =>
              item.finalSnapshotSaved ===
              true
          ).length,

        oddsAvailable:
          results.filter(
            item =>
              item.oddsAvailable ===
              true
          ).length,

        results
      };


      console.log(
        JSON.stringify(
          summary,
          null,
          2
        )
      );


      return {

        statusCode:
          200,

        headers: {

          'content-type':
            'application/json; charset=utf-8',

          'cache-control':
            'no-store'
        },

        body:
          JSON.stringify(
            summary
          )
      };


    } catch (error) {

      console.error(
        'collect-lineups :',
        error
      );


      return {

        statusCode:
          500,

        headers: {

          'content-type':
            'application/json; charset=utf-8'
        },

        body:
          JSON.stringify({

            success:
              false,

            error:
              error?.message ||
              String(error)
          })
      };
    }
  };
