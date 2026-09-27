const SPORTMONKS_API =
  'https://api.sportmonks.com/v3/football';

const OPEN_METEO_API =
  'https://api.open-meteo.com/v1/forecast';


// =====================================================
// CHAMPIONNATS MATCHSCOPE
// =====================================================

const TARGET_LEAGUES = [

  {
    code: 'LL2',

    label: 'LaLiga 2',

    // Segunda División
    id: 567,

    aliases: [
      'segunda division',
      'segunda división',
      'laliga 2',
      'la liga 2',
      'laliga hypermotion',
      'la liga hypermotion'
    ]
  },


  {
    code: 'LMX',

    label: 'Liga MX',

    id: 743,

    aliases: [
      'liga mx'
    ]
  },


  {
    code: 'CPL',

    label:
      'Canadian Premier League',

    // On le recherche automatiquement
    // dans les ligues accessibles.
    id: null,

    aliases: [
      'canadian premier league'
    ]
  },


  {
    code: 'MLS',

    label:
      'Major League Soccer',

    id: 779,

    aliases: [
      'major league soccer',
      'mls'
    ]
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

      break;
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
// IDENTIFICATION DE NOS 4 CHAMPIONNATS
// =====================================================

async function resolveTargetLeagues(
  token
) {

  const availableLeagues =
    await getAvailableLeagues(
      token
    );


  const resolved =
    [];


  const missing =
    [];


  for (
    const target
    of TARGET_LEAGUES
  ) {

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
      !found
    ) {

      found =
        availableLeagues.find(
          league => {

            const leagueName =
              normalizeName(
                league.name
              );


            return target.aliases
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
      !found
    ) {

      found =
        availableLeagues.find(
          league => {

            const leagueName =
              normalizeName(
                league.name
              );


            return target.aliases
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

    missing
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
      // RÉSOLUTION DES COMPÉTITIONS
      // ===================================

      const {

        resolved,

        missing

      } =
        await resolveTargetLeagues(
          token
        );


      if (
        !resolved.length
      ) {

        return jsonResponse(
          403,
          {

            error:
              'Aucun championnat MatchScope accessible avec cet abonnement Sportmonks.',

            missingCompetitions:
              missing
          }
        );
      }


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


        url.searchParams.set(
          'filters',

          `fixtureLeagues:${leagueIds.join(',')}`
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
                'Erreur Sportmonks',

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


        if (
          Array.isArray(
            payload.data
          )
        ) {

          allFixtures.push(
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


      // ===================================
      // TRANSFORMATION MATCHSCOPE
      // ===================================

      let matches =
        allFixtures

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
