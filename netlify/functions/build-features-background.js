const {
  supabaseRequest
} = require('./lib/supabase');


// =====================================================
// MATCHSCOPE
// FEATURE ENGINE V1
//
// Transforme les données historiques Supabase
// en variables pré-match exploitables par un modèle.
//
// IMPORTANT :
// Toutes les données historiques utilisées
// doivent être antérieures au coup d'envoi
// du match cible.
// =====================================================


const FEATURE_VERSION =
  'features-v1';


const RUN_SIZE =
  20;


const RECENT_MATCHES =
  5;


const LINEUP_HISTORY =
  10;


const MODEL_LEAGUES = [
  'PL',
  'BL',
  'LL'
];


// =====================================================
// OUTILS
// =====================================================

function array(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
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


function average(
  values
) {

  const clean =
    array(values)
      .map(
        Number
      )
      .filter(
        Number.isFinite
      );


  if (
    !clean.length
  ) {

    return null;
  }


  return (
    clean.reduce(
      (
        total,
        value
      ) =>
        total + value,
      0
    )
    /
    clean.length
  );
}


function percent(
  numerator,
  denominator
) {

  if (
    !denominator
  ) {

    return null;
  }


  return (

    numerator /
    denominator *
    100
  );
}


function daysBetween(
  first,
  second
) {

  const a =
    new Date(first);


  const b =
    new Date(second);


  if (
    Number.isNaN(
      a.getTime()
    )
    ||
    Number.isNaN(
      b.getTime()
    )
  ) {

    return null;
  }


  return (

    b.getTime() -
    a.getTime()

  )

  /

  86400000;
}


// =====================================================
// MATCHS CIBLES
// =====================================================

async function loadTargets() {

  const query =

    '?select='

    +

    [
      'sportmonks_fixture_id',
      'league_code',
      'starting_at',
      'home_team_id',
      'away_team_id',
      'lineups_confirmed'
    ].join(',')

    +

    `&league_code=in.(${MODEL_LEAGUES.join(',')})`

    +

    '&lineups_confirmed=eq.true'

    +

    '&order=starting_at.asc';


  const rows =
    await supabaseRequest(
      'matches',
      {
        method:
          'GET',

        query
      }
    );


  return array(
    rows
  );
}


// =====================================================
// FEATURES EXISTANTES
// =====================================================

async function loadExistingFeatureIds() {

  const rows =
    await supabaseRequest(
      'match_features',
      {
        method:
          'GET',

        query:

          '?select=sportmonks_fixture_id,feature_stage'

          +

          `&feature_version=eq.${FEATURE_VERSION}`
      }
    );


  const existing =
    new Set();


  array(rows).forEach(
    row => {

      existing.add(

        `${row.sportmonks_fixture_id}:${row.feature_stage}`
      );
    }
  );


  return existing;
}


// =====================================================
// HISTORIQUE MATCHS D'UNE ÉQUIPE
// =====================================================

async function loadTeamMatches(
  teamId,
  leagueCode,
  before
) {

  const query =

    '?select='

    +

    [
      'sportmonks_fixture_id',
      'starting_at',
      'home_team_id',
      'away_team_id'
    ].join(',')

    +

    `&league_code=eq.${encodeURIComponent(
      leagueCode
    )}`

    +

    `&starting_at=lt.${encodeURIComponent(
      before
    )}`

    +

    `&or=(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`

    +

    '&order=starting_at.desc'

    +

    '&limit=20';


  const rows =
    await supabaseRequest(
      'matches',
      {
        method:
          'GET',

        query
      }
    );


  return array(
    rows
  );
}


// =====================================================
// RÉSULTATS
// =====================================================

async function loadResults(
  fixtureIds
) {

  if (
    !fixtureIds.length
  ) {

    return new Map();
  }


  const rows =
    await supabaseRequest(
      'results',
      {
        method:
          'GET',

        query:

          '?select='

          +

          [
            'sportmonks_fixture_id',
            'home_score',
            'away_score'
          ].join(',')

          +

          `&sportmonks_fixture_id=in.(${fixtureIds.join(',')})`
      }
    );


  const map =
    new Map();


  array(rows).forEach(
    row => {

      map.set(

        Number(
          row.sportmonks_fixture_id
        ),

        row
      );
    }
  );


  return map;
}


// =====================================================
// STATS ÉQUIPES
// =====================================================

async function loadTeamStats(
  fixtureIds,
  teamId
) {

  if (
    !fixtureIds.length
  ) {

    return [];
  }


  const rows =
    await supabaseRequest(
      'team_match_statistics',
      {
        method:
          'GET',

        query:

          '?select='

          +

          [
            'sportmonks_fixture_id',
            'team_id',
            'type_name',
            'type_code',
            'type_developer_name',
            'value'
          ].join(',')

          +

          `&team_id=eq.${teamId}`

          +

          `&sportmonks_fixture_id=in.(${fixtureIds.join(',')})`
      }
    );


  return array(
    rows
  );
}


// =====================================================
// RECONNAÎTRE LES TYPES DE STATS
// =====================================================

function statKey(
  row
) {

  return [

    row?.type_name,

    row?.type_code,

    row?.type_developer_name

  ]

    .filter(Boolean)

    .join(' ')

    .toLowerCase();
}


function extractStat(
  stats,
  fixtureId,
  patterns
) {

  const row =
    stats.find(
      item => {

        if (
          Number(
            item.sportmonks_fixture_id
          ) !==
          Number(
            fixtureId
          )
        ) {

          return false;
        }


        const key =
          statKey(
            item
          );


        return patterns.some(
          pattern =>
            key.includes(
              pattern
            )
        );
      }
    );


  if (
    !row
  ) {

    return null;
  }


  const value =
    row.value;


  if (
    typeof value ===
    'number'
  ) {

    return value;
  }


  if (
    value &&
    typeof value ===
    'object'
  ) {

    const possible =

      value.value
      ??
      value.total
      ??
      value.count
      ??
      value.amount;


    return numberOrNull(
      possible
    );
  }


  return numberOrNull(
    value
  );
}


// =====================================================
// RÉSUMÉ DES MATCHS PRÉCÉDENTS
// =====================================================

async function buildTeamForm(
  teamId,
  leagueCode,
  kickoff
) {

  const matches =
    await loadTeamMatches(
      teamId,
      leagueCode,
      kickoff
    );


  const fixtureIds =

    matches.map(
      match =>
        Number(
          match.sportmonks_fixture_id
        )
    );


  const [
    results,
    stats
  ] =
    await Promise.all([

      loadResults(
        fixtureIds
      ),

      loadTeamStats(
        fixtureIds,
        teamId
      )
    ]);


  const completed =
    matches

      .map(
        match => {

          const result =
            results.get(
              Number(
                match.sportmonks_fixture_id
              )
            );


          if (
            !result
          ) {

            return null;
          }


          const home =
            Number(
              match.home_team_id
            ) ===
            Number(
              teamId
            );


          const goalsFor =

            home

              ? numberOrNull(
                  result.home_score
                )

              : numberOrNull(
                  result.away_score
                );


          const goalsAgainst =

            home

              ? numberOrNull(
                  result.away_score
                )

              : numberOrNull(
                  result.home_score
                );


          if (
            goalsFor === null
            ||
            goalsAgainst === null
          ) {

            return null;
          }


          let points =
            0;


          if (
            goalsFor >
            goalsAgainst
          ) {

            points =
              3;

          } else if (
            goalsFor ===
            goalsAgainst
          ) {

            points =
              1;
          }


          return {

            fixtureId:
              Number(
                match.sportmonks_fixture_id
              ),

            startingAt:
              match.starting_at,

            home,

            goalsFor,

            goalsAgainst,

            points,

            shots:
              extractStat(
                stats,
                match.sportmonks_fixture_id,
                [
                  'shots total',
                  'total shots',
                  'shots'
                ]
              ),

            shotsOnTarget:
              extractStat(
                stats,
                match.sportmonks_fixture_id,
                [
                  'shots on target',
                  'shots-on-target'
                ]
              )
          };
        }
      )

      .filter(Boolean);


  const recent =
    completed.slice(
      0,
      RECENT_MATCHES
    );


  const venueRecent =

    completed

      .filter(
        match =>
          match.home
      )

      .slice(
        0,
        RECENT_MATCHES
      );


  return {

    matches:
      completed,

    recent,

    venueRecent
  };
}


// =====================================================
// CALCUL DES FEATURES DE FORME
// =====================================================

function summarizeForm(
  form
) {

  const recent =
    form.recent;


  return {

    sample:
      recent.length,

    pointsPerMatch:
      average(
        recent.map(
          match =>
            match.points
        )
      ),

    goalsForAvg:
      average(
        recent.map(
          match =>
            match.goalsFor
        )
      ),

    goalsAgainstAvg:
      average(
        recent.map(
          match =>
            match.goalsAgainst
        )
      ),

    shotsAvg:
      average(
        recent.map(
          match =>
            match.shots
        )
      ),

    shotsOnTargetAvg:
      average(
        recent.map(
          match =>
            match.shotsOnTarget
        )
      )
  };
}


function summarizeVenue(
  matches
) {

  return {

    pointsPerMatch:
      average(
        matches.map(
          match =>
            match.points
        )
      ),

    goalsForAvg:
      average(
        matches.map(
          match =>
            match.goalsFor
        )
      ),

    goalsAgainstAvg:
      average(
        matches.map(
          match =>
            match.goalsAgainst
        )
      )
  };
}


// =====================================================
// XI HISTORIQUES
// =====================================================

async function loadStarters(
  fixtureId,
  teamId
) {

  const rows =
    await supabaseRequest(
      'lineups',
      {
        method:
          'GET',

        query:

          '?select=*'

          +

          `&sportmonks_fixture_id=eq.${fixtureId}`

          +

          `&team_id=eq.${teamId}`

          +

          '&lineup_type=eq.starter'
      }
    );


  return array(
    rows
  );
}


function overlap(
  first,
  second
) {

  const secondIds =
    new Set(

      second.map(
        player =>
          Number(
            player.player_id
          )
      )
    );


  return first.filter(
    player =>
      secondIds.has(
        Number(
          player.player_id
        )
      )
  ).length;
}


function positionGroup(
  player
) {

  const text =

    [

      player?.position,

      player
        ?.raw_data
        ?.position
        ?.name,

      player
        ?.raw_data
        ?.detailedposition
        ?.name

    ]

      .filter(Boolean)

      .join(' ')

      .toLowerCase();


  if (
    /goal|keeper|gardien/.test(
      text
    )
  ) {

    return 'goalkeeper';
  }


  if (
    /defend|back|defen/.test(
      text
    )
  ) {

    return 'defence';
  }


  if (
    /midfield|milieu/.test(
      text
    )
  ) {

    return 'midfield';
  }


  if (
    /forward|attack|striker|wing/.test(
      text
    )
  ) {

    return 'attack';
  }


  return 'other';
}


// =====================================================
// FEATURES DE COMPOSITION
// =====================================================

async function buildLineupFeatures(
  target,
  teamId
) {

  const previousMatches =
    await loadTeamMatches(
      teamId,
      target.league_code,
      target.starting_at
    );


  const history =
    [];


  for (
    const match
    of previousMatches.slice(
      0,
      LINEUP_HISTORY
    )
  ) {

    const starters =
      await loadStarters(
        match.sportmonks_fixture_id,
        teamId
      );


    if (
      starters.length >=
      11
    ) {

      history.push({

        match,

        starters
      });
    }
  }


  const current =
    await loadStarters(
      target.sportmonks_fixture_id,
      teamId
    );


  if (
    current.length <
    11
  ) {

    return null;
  }


  const appearanceCount =
    new Map();


  history.forEach(
    item => {

      item.starters.forEach(
        player => {

          const id =
            Number(
              player.player_id
            );


          appearanceCount.set(

            id,

            (
              appearanceCount.get(
                id
              )
              ||
              0
            )

            +

            1
          );
        }
      );
    }
  );


  const regularIds =
    new Set(

      Array.from(
        appearanceCount.entries()
      )

        .sort(
          (
            first,
            second
          ) =>
            second[1] -
            first[1]
        )

        .slice(
          0,
          11
        )

        .map(
          entry =>
            entry[0]
        )
  );


  const previous =
    history[0]
    ||
    null;


  const kept =

    previous

      ? overlap(
          current,
          previous.starters
        )

      : null;


  const averageOverlap =

    history.length

      ? average(

          history.map(
            item =>
              overlap(
                current,
                item.starters
              )
          )
        )

      : null;


  let historicalContinuity =
    null;


  if (
    history.length >=
    2
  ) {

    const overlaps =
      [];


    for (
      let index = 0;
      index < history.length - 1;
      index += 1
    ) {

      overlaps.push(

        overlap(

          history[index]
            .starters,

          history[index + 1]
            .starters
        )
      );
    }


    historicalContinuity =
      average(
        overlaps
      );
  }


  const regularsPresent =

    current.filter(
      player =>
        regularIds.has(
          Number(
            player.player_id
          )
        )
    ).length;


  const lines = {

    goalkeeper: {
      total: 0,
      regular: 0
    },

    defence: {
      total: 0,
      regular: 0
    },

    midfield: {
      total: 0,
      regular: 0
    },

    attack: {
      total: 0,
      regular: 0
    },

    other: {
      total: 0,
      regular: 0
    }
  };


  current.forEach(
    player => {

      const group =
        positionGroup(
          player
        );


      lines[
        group
      ].total +=
        1;


      if (
        regularIds.has(
          Number(
            player.player_id
          )
        )
      ) {

        lines[
          group
        ].regular +=
          1;
      }
    }
  );


  const formation =

    current.find(
      player =>
        player.formation
    )
      ?.formation

    ||

    null;


  const previousFormation =

    previous

      ? previous
          .starters
          .find(
            player =>
              player.formation
          )
          ?.formation
        ||
        null

      : null;


  function linePct(
    name
  ) {

    const line =
      lines[
        name
      ];


    if (
      !line.total
    ) {

      return null;
    }


    return percent(
      line.regular,
      line.total
    );
  }


  return {

    historyMatches:
      history.length,

    continuityPct:

      kept === null

        ? null

        : percent(
            kept,
            11
          ),

    changesFromPrevious:

      kept === null

        ? null

        : 11 -
          kept,

    regularsPresentPct:
      percent(
        regularsPresent,
        11
      ),

    averageOverlapPct:

      averageOverlap === null

        ? null

        : percent(
            averageOverlap,
            11
          ),

    historicalContinuityPct:

      historicalContinuity === null

        ? null

        : percent(
            historicalContinuity,
            11
          ),

    goalkeeperRegularPct:
      linePct(
        'goalkeeper'
      ),

    defenceRegularPct:
      linePct(
        'defence'
      ),

    midfieldRegularPct:
      linePct(
        'midfield'
      ),

    attackRegularPct:
      linePct(
        'attack'
      ),

    formation,

    formationChanged:

      formation &&
      previousFormation

        ? formation !==
          previousFormation

        : null
  };
}


// =====================================================
// UNE ÉQUIPE
// =====================================================

async function buildTeamFeatures(
  target,
  teamId,
  venue
) {

  const form =
    await buildTeamForm(
      teamId,
      target.league_code,
      target.starting_at
    );


  const summary =
    summarizeForm(
      form
    );


  const venueMatches =

    form.matches

      .filter(
        match =>

          venue === 'home'

            ? match.home

            : !match.home
      )

      .slice(
        0,
        RECENT_MATCHES
      );


  const venueSummary =
    summarizeVenue(
      venueMatches
    );


  const previous =
    form.matches[0]
    ||
    null;


  const restDays =

    previous

      ? daysBetween(
          previous.startingAt,
          target.starting_at
        )

      : null;


  const cutoff14 =
    new Date(
      new Date(
        target.starting_at
      ).getTime()

      -

      14 *
      86400000
    );


  const matchesLast14 =

    form.matches.filter(
      match =>

        new Date(
          match.startingAt
        ) >=
        cutoff14
    ).length;


  return {

    summary,

    venueSummary,

    restDays,

    matchesLast14
  };
}


// =====================================================
// COUVERTURE DES DONNÉES
// =====================================================

function dataCoverage(
  values
) {

  const entries =
    Object.values(
      values
    );


  if (
    !entries.length
  ) {

    return 0;
  }


  const available =

    entries.filter(
      value =>

        value !== null

        &&

        value !== undefined
    ).length;


  return percent(
    available,
    entries.length
  );
}


// =====================================================
// CRÉATION D'UN MATCH
// =====================================================

async function buildFixtureFeatures(
  target,
  stage
) {

  const [
    home,
    away
  ] =
    await Promise.all([

      buildTeamFeatures(
        target,
        Number(
          target.home_team_id
        ),
        'home'
      ),

      buildTeamFeatures(
        target,
        Number(
          target.away_team_id
        ),
        'away'
      )
    ]);


  let homeLineup =
    null;


  let awayLineup =
    null;


  if (
    stage ===
    'FINAL'
  ) {

    [
      homeLineup,
      awayLineup
    ] =
      await Promise.all([

        buildLineupFeatures(
          target,
          Number(
            target.home_team_id
          )
        ),

        buildLineupFeatures(
          target,
          Number(
            target.away_team_id
          )
        )
      ]);
  }


  const featureValues = {

    home_points_per_match_5:
      home.summary.pointsPerMatch,

    away_points_per_match_5:
      away.summary.pointsPerMatch,

    home_goals_for_avg_5:
      home.summary.goalsForAvg,

    away_goals_for_avg_5:
      away.summary.goalsForAvg,

    home_goals_against_avg_5:
      home.summary.goalsAgainstAvg,

    away_goals_against_avg_5:
      away.summary.goalsAgainstAvg,

    home_shots_avg_5:
      home.summary.shotsAvg,

    away_shots_avg_5:
      away.summary.shotsAvg,

    home_shots_on_target_avg_5:
      home.summary.shotsOnTargetAvg,

    away_shots_on_target_avg_5:
      away.summary.shotsOnTargetAvg,

    home_home_points_per_match_5:
      home.venueSummary.pointsPerMatch,

    away_away_points_per_match_5:
      away.venueSummary.pointsPerMatch,

    home_home_goals_for_avg_5:
      home.venueSummary.goalsForAvg,

    away_away_goals_for_avg_5:
      away.venueSummary.goalsForAvg,

    home_home_goals_against_avg_5:
      home.venueSummary.goalsAgainstAvg,

    away_away_goals_against_avg_5:
      away.venueSummary.goalsAgainstAvg,

    home_rest_days:
      home.restDays,

    away_rest_days:
      away.restDays,

    home_matches_last_14:
      home.matchesLast14,

    away_matches_last_14:
      away.matchesLast14
  };


  if (
    stage ===
    'FINAL'
  ) {

    Object.assign(
      featureValues,
      {

        home_xi_continuity_pct:
          homeLineup
            ?.continuityPct
          ??
          null,

        away_xi_continuity_pct:
          awayLineup
            ?.continuityPct
          ??
          null,

        home_changes_from_previous:
          homeLineup
            ?.changesFromPrevious
          ??
          null,

        away_changes_from_previous:
          awayLineup
            ?.changesFromPrevious
          ??
          null,

        home_regulars_present_pct:
          homeLineup
            ?.regularsPresentPct
          ??
          null,

        away_regulars_present_pct:
          awayLineup
            ?.regularsPresentPct
          ??
          null,

        home_average_xi_overlap_pct:
          homeLineup
            ?.averageOverlapPct
          ??
          null,

        away_average_xi_overlap_pct:
          awayLineup
            ?.averageOverlapPct
          ??
          null,

        home_historical_continuity_pct:
          homeLineup
            ?.historicalContinuityPct
          ??
          null,

        away_historical_continuity_pct:
          awayLineup
            ?.historicalContinuityPct
          ??
          null,

        home_goalkeeper_regular_pct:
          homeLineup
            ?.goalkeeperRegularPct
          ??
          null,

        away_goalkeeper_regular_pct:
          awayLineup
            ?.goalkeeperRegularPct
          ??
          null,

        home_defence_regular_pct:
          homeLineup
            ?.defenceRegularPct
          ??
          null,

        away_defence_regular_pct:
          awayLineup
            ?.defenceRegularPct
          ??
          null,

        home_midfield_regular_pct:
          homeLineup
            ?.midfieldRegularPct
          ??
          null,

        away_midfield_regular_pct:
          awayLineup
            ?.midfieldRegularPct
          ??
          null,

        home_attack_regular_pct:
          homeLineup
            ?.attackRegularPct
          ??
          null,

        away_attack_regular_pct:
          awayLineup
            ?.attackRegularPct
          ??
          null,

        home_formation:
          homeLineup
            ?.formation
          ??
          null,

        away_formation:
          awayLineup
            ?.formation
          ??
          null,

        home_formation_changed:
          homeLineup
            ?.formationChanged
          ??
          null,

        away_formation_changed:
          awayLineup
            ?.formationChanged
          ??
          null
      }
    );
  }


  return {

    sportmonks_fixture_id:
      Number(
        target.sportmonks_fixture_id
      ),

    feature_stage:
      stage,

    feature_version:
      FEATURE_VERSION,

    generated_at:
      new Date()
        .toISOString(),

    source_cutoff_at:
      target.starting_at,

    league_code:
      target.league_code,

    starting_at:
      target.starting_at,

    home_team_id:
      Number(
        target.home_team_id
      ),

    away_team_id:
      Number(
        target.away_team_id
      ),

    home_matches_sample:
      home.summary.sample,

    away_matches_sample:
      away.summary.sample,

    ...featureValues,

    home_absences_count:
      null,

    away_absences_count:
      null,

    home_regular_absences_count:
      null,

    away_regular_absences_count:
      null,

    data_coverage:
      dataCoverage(
        featureValues
      ),

    raw_features: {

      feature_version:
        FEATURE_VERSION,

      stage,

      leakage_guard:
        'ONLY_DATA_BEFORE_KICKOFF',

      generated_at:
        new Date()
          .toISOString(),

      home_history_matches:
        home.summary.sample,

      away_history_matches:
        away.summary.sample,

      home_lineup_history:
        homeLineup
          ?.historyMatches
        ??
        null,

      away_lineup_history:
        awayLineup
          ?.historyMatches
        ??
        null
    }
  };
}


// =====================================================
// UPSERT
// =====================================================

async function saveFeature(
  row
) {

  return supabaseRequest(
    'match_features',
    {
      method:
        'POST',

      query:

        '?on_conflict='

        +

        encodeURIComponent(

          'sportmonks_fixture_id,feature_stage,feature_version'
        ),

      body:
        row,

      prefer:
        'resolution=merge-duplicates,return=minimal'
    }
  );
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

      return {
        statusCode:
          405,

        body:
          JSON.stringify({
            success:
              false,

            error:
              'POST requis.'
          })
      };
    }


    let body =
      {};


    try {

      body =
        JSON.parse(
          event.body ||
          '{}'
        );

    } catch {

      body =
        {};
    }


    const secret =
      process
        .env
        .MATCHSCOPE_SYNC_SECRET;


    if (
      !secret
      ||
      body?.secret !==
      secret
    ) {

      return {
        statusCode:
          401,

        body:
          JSON.stringify({
            success:
              false,

            error:
              'Accès non autorisé.'
          })
      };
    }


    try {

      const [
        targets,
        existing
      ] =
        await Promise.all([

          loadTargets(),

          loadExistingFeatureIds()
        ]);


      const todo =
        [];


      for (
        const target
        of targets
      ) {

        const id =
          Number(
            target.sportmonks_fixture_id
          );


        if (
          !existing.has(
            `${id}:PRELINEUP`
          )
        ) {

          todo.push({
            target,
            stage:
              'PRELINEUP'
          });
        }


        if (
          target.lineups_confirmed ===
          true

          &&

          !existing.has(
            `${id}:FINAL`
          )
        ) {

          todo.push({
            target,
            stage:
              'FINAL'
          });
        }
      }


      const batch =
        todo.slice(
          0,
          RUN_SIZE
        );


      const results =
        [];


      for (
        const item
        of batch
      ) {

        try {

          const row =
            await buildFixtureFeatures(
              item.target,
              item.stage
            );


          await saveFeature(
            row
          );


          results.push({

            fixtureId:
              row.sportmonks_fixture_id,

            stage:
              row.feature_stage,

            coverage:
              row.data_coverage,

            status:
              'SAVED'
          });


        } catch (
          error
        ) {

          results.push({

            fixtureId:
              item
                .target
                .sportmonks_fixture_id,

            stage:
              item.stage,

            status:
              'ERROR',

            error:
              error?.message
              ||
              String(
                error
              )
          });
        }
      }


      return {

        statusCode:
          200,

        body:
          JSON.stringify({

            success:
              true,

            featureVersion:
              FEATURE_VERSION,

            targets:
              targets.length,

            remainingBeforeRun:
              todo.length,

            processed:
              batch.length,

            remainingAfterRun:
              Math.max(
                0,
                todo.length -
                batch.length
              ),

            results
          })
      };


    } catch (
      error
    ) {

      console.error(
        'build-features-background:',
        error
      );


      return {

        statusCode:
          500,

        body:
          JSON.stringify({

            success:
              false,

            error:
              error?.message
              ||
              String(
                error
              )
          })
      };
    }
  };
