const { supabaseRequest } = require('./lib/supabase');

const SPORTMONKS_API =
  'https://api.sportmonks.com/v3/football';

const OPEN_METEO_API =
  'https://api.open-meteo.com/v1/forecast';


// =====================================================
// CHAMPIONNATS MATCHSCOPE
// =====================================================

const TARGET_LEAGUES = [
  {
    code: 'L1',
    label: 'Ligue 1',
    id: 301
  },
  {
    code: 'LL',
    label: 'La Liga',
    id: 564
  },
  {
    code: 'SA',
    label: 'Serie A',
    id: 384
  },
  {
    code: 'PL',
    label: 'Premier League',
    id: 8
  },
  {
    code: 'BL',
    label: 'Bundesliga 1',
    id: 82
  }
];
// =====================================================
// OUTILS
// =====================================================

function iso(date) {

  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


function normalizeName(
  value
) {

  return String(
    value || ''
  )
    .normalize('NFD')

    .replace(
      /[\u0300-\u036f]/g,
      ''
    )

    .trim()

    .toLowerCase();
}


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


function getTeam(
  participants = [],
  location
) {

  return participants.find(
    participant =>

      participant
        ?.meta
        ?.location ===
      location

  ) || null;
}


function parseKickoff(
  startingAt
) {

  if (
    !startingAt
  ) {

    return null;
  }


  const raw =
    String(
      startingAt
    ).trim();


  // Format habituel Sportmonks :
  // 2026-10-10 20:00:00

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
    new Date(
      raw
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return null;
  }


  return date;
}


// =====================================================
// LIGUES ACCESSIBLES SPORTMONKS
// =====================================================

async function getAvailableLeagues(
  token
) {

  const leagues =
    [];


  let page =
    1;


  let hasMore =
    true;


  while (
    hasMore &&
    page <= 30
  ) {

    const url =
      new URL(
        `${SPORTMONKS_API}/leagues`
      );


    url.searchParams.set(
      'api_token',
      token
    );


    url.searchParams.set(
      'per_page',
      '100'
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


    if (
      !response.ok
    ) {

      throw new Error(
        'Sportmonks /leagues a répondu HTTP ' +
        response.status +
        '. Vérifiez la clé API et les droits de votre abonnement.'
      );
    }


    const payload =
      await response.json();


    if (
      Array.isArray(
        payload.data
      )
    ) {

      leagues.push(
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


  return leagues;
}


// =====================================================
// IDENTIFICATION DE NOS 5 CHAMPIONNATS
// =====================================================

async function resolveTargetLeagues(
  token
) {

  let availableLeagues =
    await getAvailableLeagues(
      token
    );

  // L'endpoint "My Leagues" est la référence des ligues
  // autorisées pour l'abonnement associé à ce jeton.
  // On le consulte en secours si /football/leagues ne
  // trouve aucune de nos cinq compétitions.
  const hasSelectedLeague =
    availableLeagues.some(
      league =>
        TARGET_LEAGUES.some(
          target =>
            Number(league.id) ===
            Number(target.id)
        )
    );

  if (!hasSelectedLeague) {
    try {
      const accountUrl = new URL(
        'https://api.sportmonks.com/v3/my/leagues'
      );
      accountUrl.searchParams.set(
        'api_token',
        token
      );
      const accountResponse = await fetch(accountUrl);
      if (accountResponse.ok) {
        const accountPayload = await accountResponse.json();
        if (Array.isArray(accountPayload.data)) {
          availableLeagues = accountPayload.data.map(
            league => league.league || league
          );
        }
      } else {
        console.warn(
          'Sportmonks My Leagues : HTTP',
          accountResponse.status
        );
      }
    } catch (error) {
      console.warn(
        'Sportmonks My Leagues indisponible',
        error?.name || 'fetch error'
      );
    }
  }


  const resolved =
    [];


  const missing =
    [];


  for (
    const target
    of TARGET_LEAGUES
  ) {

    // Aucun alias n'est défini dans TARGET_LEAGUES ;
    // utiliser le libellé pour éviter une erreur TypeError.
    const aliases =
      Array.isArray(target.aliases) &&
      target.aliases.length
        ? target.aliases
        : [target.label];

    let found =
      null;


    // -------------------------------
    // 1. Recherche par ID connu
    // -------------------------------

    if (
      target.id !== null &&
      target.id !== undefined
    ) {

      found =
        availableLeagues.find(
          league =>

            Number(
              league.id
            ) ===
            Number(
              target.id
            )
        );
    }


    // -------------------------------
    // 2. Recherche par nom
    // -------------------------------

    if (
      !found &&
      (target.id === null || target.id === undefined)
    ) {

      found =
        availableLeagues.find(
          league => {

            const leagueName =
              normalizeName(
                league.name
              );


            return aliases
              .some(
                alias =>

                  leagueName ===
                  normalizeName(
                    alias
                  )
              );
          }
        );
    }


    // -------------------------------
    // 3. Recherche souple
    //    utile pour CPL
    // -------------------------------

    if (
      !found &&
      (target.id === null || target.id === undefined)
    ) {

      found =
        availableLeagues.find(
          league => {

            const leagueName =
              normalizeName(
                league.name
              );


            return aliases
              .some(
                alias => {

                  const wanted =
                    normalizeName(
                      alias
                    );


                  return (
                    leagueName.includes(
                      wanted
                    ) ||
                    wanted.includes(
                      leagueName
                    )
                  );
                }
              );
          }
        );
    }


    if (
      found
    ) {

      resolved.push({

        code:
          target.code,

        label:
          target.label,

        id:
          Number(
            found.id
          ),

        apiName:
          found.name
      });

    } else {

      missing.push(
        target.label
      );
    }
  }


  return {

    resolved,

    missing,

    availableLeagueCount:
      availableLeagues.length
  };
}


// =====================================================
// MÉTÉO OPEN-METEO
// =====================================================

function weatherDescription(
  code
) {

  const value =
    Number(
      code
    );


  if (
    value === 0
  ) {

    return 'Ciel dégagé';
  }


  if (
    value === 1
  ) {

    return 'Globalement dégagé';
  }


  if (
    value === 2
  ) {

    return 'Partiellement nuageux';
  }


  if (
    value === 3
  ) {

    return 'Couvert';
  }


  if (
    value === 45 ||
    value === 48
  ) {

    return 'Brouillard';
  }


  if (
    [
      51,
      53,
      55
    ].includes(
      value
    )
  ) {

    return 'Bruine';
  }


  if (
    [
      61,
      63,
      65
    ].includes(
      value
    )
  ) {

    return 'Pluie';
  }


  if (
    [
      66,
      67
    ].includes(
      value
    )
  ) {

    return 'Pluie verglaçante';
  }


  if (
    [
      71,
      73,
      75,
      77
    ].includes(
      value
    )
  ) {

    return 'Neige';
  }


  if (
    [
      80,
      81,
      82
    ].includes(
      value
    )
  ) {

    return 'Averses';
  }


  if (
    [
      95,
      96,
      99
    ].includes(
      value
    )
  ) {

    return 'Orage';
  }


  return 'Conditions variables';
}


// =====================================================
// REQUÊTE OPEN-METEO PAR LOT
// =====================================================

async function getWeatherBatch(
  locations
) {

  if (
    !locations.length
  ) {

    return [];
  }


  const url =
    new URL(
      OPEN_METEO_API
    );


  url.searchParams.set(
    'latitude',

    locations
      .map(
        location =>
          location.latitude
      )
      .join(',')
  );


  url.searchParams.set(
    'longitude',

    locations
      .map(
        location =>
          location.longitude
      )
      .join(',')
  );


  url.searchParams.set(
    'hourly',

    [

      'temperature_2m',

      'precipitation_probability',

      'precipitation',

      'weather_code',

      'wind_speed_10m',

      'wind_gusts_10m'

    ].join(',')
  );


  url.searchParams.set(
    'forecast_days',
    '16'
  );


  url.searchParams.set(
    'timezone',
    'UTC'
  );


  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    return [];
  }


  const data =
    await response.json();


  if (
    Array.isArray(
      data
    )
  ) {

    return data;
  }


  return [
    data
  ];
}


// =====================================================
// MÉTÉO À L'HEURE DU COUP D'ENVOI
// =====================================================

function weatherAtKickoff(
  forecast,
  kickoff
) {

  if (
    !forecast ||
    !kickoff ||
    !Array.isArray(
      forecast
        ?.hourly
        ?.time
    )
  ) {

    return null;
  }


  let bestIndex =
    -1;


  let bestDifference =
    Infinity;


  forecast.hourly.time
    .forEach(
      (
        time,
        index
      ) => {

        const timestamp =
          new Date(
            `${time}Z`
          )
            .getTime();


        if (
          Number.isNaN(
            timestamp
          )
        ) {

          return;
        }


        const difference =
          Math.abs(

            timestamp -

            kickoff
              .getTime()
          );


        if (
          difference <
          bestDifference
        ) {

          bestDifference =
            difference;

          bestIndex =
            index;
        }
      }
    );


  if (
    bestIndex < 0
  ) {

    return null;
  }


  if (
    bestDifference >
    2 *
    60 *
    60 *
    1000
  ) {

    return null;
  }


  return {

    temperature:
      forecast
        ?.hourly
        ?.temperature_2m
        ?.[bestIndex],


    rainProbability:
      forecast
        ?.hourly
        ?.precipitation_probability
        ?.[bestIndex],


    precipitation:
      forecast
        ?.hourly
        ?.precipitation
        ?.[bestIndex],


    wind:
      forecast
        ?.hourly
        ?.wind_speed_10m
        ?.[bestIndex],


    gusts:
      forecast
        ?.hourly
        ?.wind_gusts_10m
        ?.[bestIndex],


    weatherCode:
      forecast
        ?.hourly
        ?.weather_code
        ?.[bestIndex]
  };
}


// =====================================================
// TEXTE MÉTÉO
// =====================================================

function formatWeather(
  weather
) {

  if (
    !weather
  ) {

    return 'Prévision météo indisponible';
  }


  const parts =
    [];


  parts.push(
    weatherDescription(
      weather.weatherCode
    )
  );


  if (
    Number.isFinite(
      Number(
        weather.temperature
      )
    )
  ) {

    parts.push(
      `${Math.round(
        Number(
          weather.temperature
        )
      )}°C`
    );
  }


  if (
    Number.isFinite(
      Number(
        weather.rainProbability
      )
    )
  ) {

    parts.push(
      `pluie ${Math.round(
        Number(
          weather.rainProbability
        )
      )}%`
    );
  }


  if (
    Number.isFinite(
      Number(
        weather.precipitation
      )
    ) &&
    Number(
      weather.precipitation
    ) > 0
  ) {

    parts.push(
      `${Number(
        weather.precipitation
      ).toFixed(
        1
      )} mm`
    );
  }


  if (
    Number.isFinite(
      Number(
        weather.wind
      )
    )
  ) {

    parts.push(
      `vent ${Math.round(
        Number(
          weather.wind
        )
      )} km/h`
    );
  }


  if (
    Number.isFinite(
      Number(
        weather.gusts
      )
    )
  ) {

    parts.push(
      `rafales ${Math.round(
        Number(
          weather.gusts
        )
      )} km/h`
    );
  }


  return parts.join(
    ' • '
  );
}


// =====================================================
// AJOUT MÉTÉO AUX MATCHS
// =====================================================

async function attachWeather(
  matches
) {

  const now =
    Date.now();


  const weatherLimit =
    now +
    16 *
    24 *
    60 *
    60 *
    1000;


  const candidates =
    matches.filter(
      match => {

        if (
          !match._kickoff ||
          !Number.isFinite(
            match._latitude
          ) ||
          !Number.isFinite(
            match._longitude
          )
        ) {

          return false;
        }


        const kickoff =
          match
            ._kickoff
            .getTime();


        return (

          kickoff >=
          now &&

          kickoff <=
          weatherLimit
        );
      }
    );


  const unique =
    new Map();


  candidates.forEach(
    match => {

      const key =
        `${match._latitude},${match._longitude}`;


      if (
        !unique.has(
          key
        )
      ) {

        unique.set(
          key,
          {

            key,

            latitude:
              match._latitude,

            longitude:
              match._longitude
          }
        );
      }
    }
  );


  const locations =
    Array.from(
      unique.values()
    );


  const weatherByLocation =
    new Map();


  // Maximum 20 stades par requête.

  for (
    let index = 0;
    index < locations.length;
    index += 20
  ) {

    const batch =
      locations.slice(
        index,
        index + 20
      );


    try {

      const forecasts =
        await getWeatherBatch(
          batch
        );


      batch.forEach(
        (
          location,
          position
        ) => {

          if (
            forecasts[position]
          ) {

            weatherByLocation.set(

              location.key,

              forecasts[
                position
              ]
            );
          }
        }
      );

    } catch (
      _error
    ) {

      // L'absence de météo
      // ne doit jamais bloquer
      // les matchs.
    }
  }


  matches.forEach(
    match => {

      if (
        !match._kickoff
      ) {

        match.weather =
          'Prévision météo indisponible';

        return;
      }


      if (
        match
          ._kickoff
          .getTime() >
        weatherLimit
      ) {

        match.weather =
          'Prévision disponible à partir de J-16';

        return;
      }


      if (
        !Number.isFinite(
          match._latitude
        ) ||
        !Number.isFinite(
          match._longitude
        )
      ) {

        match.weather =
          'Coordonnées du stade indisponibles';

        return;
      }


      const key =
        `${match._latitude},${match._longitude}`;


      const forecast =
        weatherByLocation.get(
          key
        );


      const weather =
        weatherAtKickoff(

          forecast,

          match._kickoff
        );


      match.weather =
        formatWeather(
          weather
        );


      match.weatherData =
        weather;
    }
  );


  return matches;
}



// Relit les pronostics figés et les confirmations XI déjà conservés dans Supabase.
// Le calendrier Sportmonks ne contient volontairement aucune de ces données :
// surtout ne pas les remplacer par 'en attente' à chaque actualisation.
async function restoreSavedMatchData(matches) {
  if (!Array.isArray(matches) || !matches.length) return;
  const ids = [...new Set(matches.map(m => String(m.id))
    .filter(id => /^[1-9][0-9]{0,11}$/.test(id)))];
  if (!ids.length) return;

  for (const match of matches) {
    match.kickoffTs = match._kickoff?.getTime() || null;
    match.started = Number.isFinite(match.kickoffTs) &&
      match.kickoffTs <= Date.now();
    match.prematchPredictionStored = false;
  }

  // Traitement par lots pour ne pas dépasser la taille des URL PostgREST.
  try {
    const matchesStored = [];
    const predictionsStored = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const set = ids.slice(offset, offset + 50).join(',');
      const filter = '&sportmonks_fixture_id=in.(' + set + ')';
      const [savedMatches, savedPredictions] = await Promise.all([
        supabaseRequest('matches', {
          query: '?select=sportmonks_fixture_id,lineups_confirmed' + filter
        }),
        supabaseRequest('predictions', {
          query: '?select=sportmonks_fixture_id,prediction_stage,generated_at,locked,lineup_confirmed,probability_home,probability_draw,probability_away,data_coverage' +
            filter + '&order=generated_at.desc'
        })
      ]);
      if (Array.isArray(savedMatches)) matchesStored.push(...savedMatches);
      if (Array.isArray(savedPredictions)) predictionsStored.push(...savedPredictions);
    }
    const storedById = new Map(matchesStored.map(row =>
      [String(row.sportmonks_fixture_id), row]));
    const predictedById = new Map();
    for (const row of predictionsStored) {
      const key = String(row.sportmonks_fixture_id);
      if (!predictedById.has(key)) predictedById.set(key, []);
      predictedById.get(key).push(row);
    }

    for (const match of matches) {
      const saved = storedById.get(String(match.id));
      if (saved?.lineups_confirmed === true) {
        match.official = true;
        match.officialSource = 'saved';
      }
      // Aucune estimation créée après le début du match ne peut être
      // affichée comme une prévision pré-match.
      const valid = (predictedById.get(String(match.id)) || [])
        .filter(row => {
          const timestamp = Date.parse(row.generated_at || '');
          const probs = [row.probability_home, row.probability_draw,
            row.probability_away].map(Number);
          return row.locked === true &&
            Number.isFinite(timestamp) &&
            Number.isFinite(match.kickoffTs) &&
            timestamp < match.kickoffTs &&
            probs.every(n => Number.isFinite(n) && n >= 0 && n <= 1) &&
            Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < 0.02;
        })
        .sort((a, b) => {
          if (a.prediction_stage !== b.prediction_stage) {
            return a.prediction_stage === 'FINAL' ? -1 : 1;
          }
          return Date.parse(b.generated_at) - Date.parse(a.generated_at);
        });
      const row = valid[0];
      if (!row) continue;

      match.prematchPredictionStored = true;
      match.predictionStage = row.prediction_stage;
      match.predictionGeneratedAt = row.generated_at;
      match.probs = {
        home: Number(row.probability_home) * 100,
        draw: Number(row.probability_draw) * 100,
        away: Number(row.probability_away) * 100
      };
      const coverage = Number(row.data_coverage);
      if (Number.isFinite(coverage) && coverage >= 0 && coverage <= 100) {
        match.quality = coverage;
      }
      if (row.prediction_stage === 'FINAL' && row.lineup_confirmed === true) {
        match.official = true;
        match.officialSource = 'saved';
      }
    }
  } catch (_error) {
    // On garde les matchs accessibles sans transformer une erreur de
    // lecture Supabase en fausse affirmation 'jamais analysé'.
    for (const match of matches) match.savedDataUnavailable = true;
    console.warn('MatchScope fixtures: lecture des analyses archivées indisponible');
  }
}

// =====================================================
// FONCTION NETLIFY
// =====================================================

exports.handler =
  async () => {

    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (
      !token
    ) {

      return jsonResponse(
        500,
        {

          error:
            'SPORTMONKS_API_TOKEN absent dans Netlify.'
        }
      );
    }


    try {

      // ===================================
      // CHAMPIONNATS DU PLAN
      // ===================================

      // Les IDs sont confirmés dans MySportmonks.
      // Ne pas bloquer les matchs sur un appel préalable
      // à /leagues : un tableau vide n'est pas une preuve
      // de l'absence d'abonnement. Le vrai statut d'accès
      // sera fourni par l'endpoint fixtures lui-même.
      const resolved =
        TARGET_LEAGUES.map(
          league => ({
            ...league,
            apiName: league.label
          })
        );

      const missing = [];



      const leagueIds =
        resolved.map(
          league =>
            league.id
        );


      const leagueCodeMap =
        Object.fromEntries(

          resolved.map(
            league => [

              String(
                league.id
              ),

              league.code
            ]
          )
        );


      // ===================================
      // PÉRIODE DE RECHERCHE
      // ===================================

      const start =
        new Date();


      // 35 jours :
      // utile notamment pour traverser
      // les périodes sans journée.

      const end =
        new Date(

          Date.now() +

          35 *
          24 *
          60 *
          60 *
          1000
        );


      const endpoint =
        `${SPORTMONKS_API}/fixtures/between/${iso(start)}/${iso(end)}`;


      // ===================================
      // FIXTURES
      // ===================================

      const allFixtures =
        [];

      const upstreamCounts = {
        pages: 0,
        received: 0,
        upstreamLeagues: [],
        subscriptionPlans: []
      };


      let page =
        1;


      let hasMore =
        true;


      while (
        hasMore &&
        page <= 20
      ) {

        const url =
          new URL(
            endpoint
          );


        url.searchParams.set(
          'api_token',
          token
        );


        // Sportmonks confirme "fixtureLeagues" sur
        // l'endpoint fixtures/between. Sans ce filtre,
        // l'API retourne seulement les ligues par défaut
        // 501 et 271, même avec un token donnant accès aux
        // cinq championnats de MatchScope.
        url.searchParams.set(
          'filters',
          'fixtureLeagues:' + leagueIds.join(',')
        );

        // On reste volontairement
        // sur les données de base.

        url.searchParams.set(
          'include',

          'league;participants;venue'
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

          return jsonResponse(
            response.status,
            {

              error:
                response.status === 403
                  ? 'Sportmonks refuse cette requête de matchs avec le jeton Netlify (HTTP 403). Cela ne prouve pas que ton abonnement est absent : vérifie que le jeton de production est le même que celui du test Sportmonks et que cet endpoint est autorisé.'
                  : 'Erreur Sportmonks',

              status:
                response.status,

              details:
                raw.slice(
                  0,
                  1600
                )
            }
          );
        }


        let payload;


        try {

          payload =
            JSON.parse(
              raw
            );

        } catch {

          return jsonResponse(
            502,
            {

              error:
                'Réponse Sportmonks illisible',

              details:
                raw.slice(
                  0,
                  1000
                )
            }
          );
        }


        // Le statut réel de l'abonnement est fourni avec
        // la réponse API, comme dans le test Sportmonks.
        // On n'affiche que le nom du forfait : jamais
        // le jeton, les en-têtes ni les coordonnées.
        if (Array.isArray(payload.subscription)) {
          const names = payload.subscription.flatMap(
            item => Array.isArray(item.plans)
              ? item.plans.map(p => ({
                  plan: String(p.plan || 'Inconnu'),
                  category: String(p.category || '')
                }))
              : []
          );
          if (names.length) {
            upstreamCounts.subscriptionPlans = names;
          }
        }

        if (
          Array.isArray(
            payload.data
          )
        ) {
          allFixtures.push(
            ...payload.data
          );
          upstreamCounts.received += payload.data.length;
        } else {
          console.warn(
            'MatchScope fixtures: réponse sans tableau data',
            { page, responseKeys: Object.keys(payload || {}) }
          );
        }
        upstreamCounts.pages += 1;


        hasMore =
          Boolean(

            payload
              ?.pagination
              ?.has_more
          );


        page +=
          1;
      }


      // ===================================
      // TRANSFORMATION MATCHSCOPE
      // ===================================

      const subscribedLeagueIds =
        new Set(leagueIds.map(String));

      const fixtureLeagueId = fixture =>
        fixture?.league_id ??
        fixture?.league?.id ??
        null;

      const filteredFixtures =
        allFixtures.filter(
          fixture =>
            subscribedLeagueIds.has(
              String(fixtureLeagueId(fixture))
            )
        );

      // Donner le détail réel des ligues reçues, sans
      // exposer le jeton API ni de données personnelles.
      const leagueCounts = new Map();
      for (const fixture of allFixtures) {
        const id = String(fixtureLeagueId(fixture));
        const name = fixture?.league?.name || '';
        const previous = leagueCounts.get(id) || {
          id,
          name,
          count: 0
        };
        previous.count += 1;
        if (!previous.name && name) previous.name = name;
        leagueCounts.set(id, previous);
      }
      const upstreamLeagues = [...leagueCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      // Un appel léger, seulement lorsque la recherche
      // reste vide, permet de vérifier l'accès aux ligues
      // avec le jeton réellement chargé par Netlify.
      let allowedLeagues = null;
      if (!filteredFixtures.length) {
        try {
          const leaguesUrl = new URL(
            SPORTMONKS_API + '/leagues'
          );
          leaguesUrl.searchParams.set('api_token', token);
          leaguesUrl.searchParams.set('per_page', '50');
          const leaguesRes = await fetch(leaguesUrl, {
            signal: AbortSignal.timeout(8000)
          });
          allowedLeagues = {
            httpStatus: leaguesRes.status,
            leagues: []
          };
          if (leaguesRes.ok) {
            const body = await leaguesRes.json();
            allowedLeagues.leagues = Array.isArray(body.data)
              ? body.data.slice(0, 20).map(l => ({
                  id: l.id,
                  name: l.name
                }))
              : [];
            if (
              !upstreamCounts.subscriptionPlans.length &&
              Array.isArray(body.subscription)
            ) {
              upstreamCounts.subscriptionPlans =
                body.subscription.flatMap(item =>
                  Array.isArray(item.plans)
                    ? item.plans.map(p => ({
                        plan: String(p.plan || 'Inconnu'),
                        category: String(p.category || '')
                      }))
                    : []
                );
            }
          }
        } catch (error) {
          allowedLeagues = {
            httpStatus: null,
            error: error?.name || 'request failed',
            leagues: []
          };
        }
      }

      // Vérification supplémentaire : l'identifiant du
      // match Tottenham-Crystal Palace vient du test
      // Sportmonks fourni par le propriétaire du projet.
      // Un code 403 ici peut révéler un droit différent
      // entre ce test et le jeton utilisé sur Netlify.
      let referenceFixture = null;
      if (!filteredFixtures.length) {
        try {
          const referenceUrl = new URL(
            `${SPORTMONKS_API}/fixtures/19722114`
          );
          referenceUrl.searchParams.set('api_token', token);
          const check = await fetch(referenceUrl, {
            signal: AbortSignal.timeout(6000)
          });
          referenceFixture = { httpStatus: check.status };
          if (check.ok) {
            const checkPayload = await check.json();
            referenceFixture.leagueId =
              checkPayload?.data?.league_id ??
              checkPayload?.data?.league?.id ??
              null;
          }
        } catch (error) {
          referenceFixture = {
            httpStatus: null,
            error: error?.name || 'fetch failed'
          };
        }
      }

      console.info('MatchScope fixtures', {
        rangeStart: iso(start),
        rangeEnd: iso(end),
        pages: upstreamCounts.pages,
        received: upstreamCounts.received,
        selected: filteredFixtures.length,
        upstreamLeagueIds: [
          ...new Set(
            allFixtures.map(fixture => fixture.league_id)
          )
        ].slice(0, 20)
      });

      let matches =
        filteredFixtures

          .sort(
            (
              first,
              second
            ) => {

              const firstDate =
                parseKickoff(
                  first
                    ?.starting_at
                )
                  ?.getTime() ||
                0;


              const secondDate =
                parseKickoff(
                  second
                    ?.starting_at
                )
                  ?.getTime() ||
                0;


              return (
                firstDate -
                secondDate
              );
            }
          )

          .map(
            fixture => {

              const participants =
                Array.isArray(
                  fixture
                    .participants
                )

                  ? fixture
                      .participants

                  : [];


              const home =
                getTeam(
                  participants,
                  'home'
                ) ||

                participants[0] ||

                {};


              const away =
                getTeam(
                  participants,
                  'away'
                ) ||

                participants[1] ||

                {};


              const kickoff =
                parseKickoff(
                  fixture
                    .starting_at
                );


              const latitude =
                Number(
                  fixture
                    ?.venue
                    ?.latitude
                );


              const longitude =
                Number(
                  fixture
                    ?.venue
                    ?.longitude
                );


              return {

                id:
                  String(
                    fixture.id
                  ),


                competition:

                  leagueCodeMap[
                    String(
                      fixture
                        .league_id
                    )
                  ] ||

                  'OTHER',


                competitionName:

                  fixture
                    ?.league
                    ?.name ||

                  'Compétition',


                date:

                  kickoff

                    ? kickoff
                        .toLocaleDateString(
                          'fr-FR',
                          {

                            day:
                              '2-digit',

                            month:
                              'short',

                            timeZone:
                              'Europe/Paris'
                          }
                        )

                    : '—',


                time:

                  kickoff

                    ? kickoff
                        .toLocaleTimeString(
                          'fr-FR',
                          {

                            hour:
                              '2-digit',

                            minute:
                              '2-digit',

                            timeZone:
                              'Europe/Paris'
                          }
                        )

                    : '—',


                home:

                  home?.name ||

                  'Domicile',


                away:

                  away?.name ||

                  'Extérieur',


                venue:

                  fixture
                    ?.venue
                    ?.name ||

                  'Stade à confirmer',


                surface:

                  fixture
                    ?.venue
                    ?.surface ||

                  'À confirmer',


                weather:
                  null,


                // Pour le moment :
                // aucune fausse composition.

                official:
                  false,


                quality:
                  50,


                confidence:
                  null,


                // Aucun pronostic inventé.

                probs: {

                  home:
                    null,

                  draw:
                    null,

                  away:
                    null
                },


                formationHome:
                  '—',


                formationAway:
                  '—',


                homeXI: [

                  'Composition en attente'
                ],


                awayXI: [

                  'Composition en attente'
                ],


                absences:

                  'Blessures, suspensions et compositions seront ajoutées dans le moteur d’analyse.',


                factors: [

                  [

                    'Calendrier live',

                    'Match récupéré directement depuis Sportmonks.',

                    'LIVE',

                    'pos'
                  ],

                  [

                    'Météo',

                    'Prévision Open-Meteo calculée au stade lorsque disponible.',

                    'AUTO',

                    'mid'
                  ]
                ],


                markets:
                  [],


                sources: [

                  [

                    'Sportmonks Football API',

                    'Calendrier, équipes et stade.',

                    'Live'
                  ],

                  [

                    'Open-Meteo',

                    'Température, pluie, vent et rafales à l’heure du match.',

                    'Météo'
                  ]
                ],


                // Variables internes.
                // Elles seront supprimées
                // avant envoi au navigateur.

                _kickoff:
                  kickoff,


                _latitude:

                  Number.isFinite(
                    latitude
                  )

                    ? latitude

                    : null,


                _longitude:

                  Number.isFinite(
                    longitude
                  )

                    ? longitude

                    : null
              };
            }
          );


      // ===================================
      // AJOUT MÉTÉO
      // ===================================

      matches =
        await attachWeather(
          matches
        );

      // Réintègre les archives persistantes AVANT de répondre au navigateur.
      await restoreSavedMatchData(matches);


      // ===================================
      // NETTOYAGE CHAMPS INTERNES
      // ===================================

      matches =
        matches.map(
          match => {

            delete match
              ._kickoff;


            delete match
              ._latitude;


            delete match
              ._longitude;


            return match;
          }
        );


      // ===================================
      // RÉPONSE
      // ===================================

      return jsonResponse(
        200,
        {

          live:
            true,


          competitions:
            resolved,


          missingCompetitions:
            missing,


          from:
            iso(
              start
            ),


          to:
            iso(
              end
            ),


          count:
            matches.length,

          sourceDiagnostics: {
            received:
              upstreamCounts.received,
            selected:
              filteredFixtures.length,
            pages:
              upstreamCounts.pages,
            upstreamLeagues,
            subscriptionPlans: upstreamCounts.subscriptionPlans,
            allowedLeagues,
            referenceFixture
          },

          notice: matches.length === 0
            ? 'Aucun match retourné avec le filtre Sportmonks fixtureLeagues pour tes cinq championnats. Les identifiants et le test du match de Premier League permettent de diagnostiquer le droit d’accès.'
            : null,

          matches
        }
      );


    } catch (
      error
    ) {

      return jsonResponse(
        500,
        {

          error:
            'Erreur interne MatchScope',

          details:

            error?.message ||

            String(
              error
            )
        }
      );
    }
  };
