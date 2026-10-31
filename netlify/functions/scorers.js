'use strict';

// MatchScope — indicateurs de buteurs basés sur les statistiques Sportmonks.
// Un score chiffré n'est calculé que si buts ET apparitions sont disponibles.
// Ce modèle exploratoire n'est pas une probabilité calibrée pour le pari.
const BASE = 'https://api.sportmonks.com/v3/football';
const LEAGUES = new Set([301, 564, 384, 8, 82]);
const METRICS = { goals: 52, appearances: 321, minutes: 119, shots: 42, xg: 5304 };
const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'Cache-Control': statusCode === 200 ? 'public, max-age=60' : 'no-store',
    'Netlify-CDN-Cache-Control': statusCode === 200
      ? 'public, max-age=600, stale-while-revalidate=120'
      : 'no-store'
  },
  body: JSON.stringify(body)
});

async function sportmonks(path, token, include) {
  const url = new URL(BASE + path);
  url.searchParams.set('api_token', token);
  if (include) url.searchParams.set('include', include);
  const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!response.ok) {
    const err = new Error('Sportmonks HTTP ' + response.status);
    err.status = response.status;
    throw err;
  }
  const result = await response.json();
  return result.data;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    for (const key of ['total', 'count', 'value', 'all', 'average']) {
      if (value[key] !== undefined) return numeric(value[key]);
    }
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function metric(details, id) {
  if (!Array.isArray(details)) return null;
  const entry = details.find(d => Number(d.type_id) === id);
  return entry ? numeric(entry.value) : null;
}

function mainTeam(participants, place, fallback) {
  return participants.find(p => p?.meta?.location === place)
    || participants[fallback] || null;
}

function lineupState(fixture) {
  // Les lineups Sportmonks peuvent être prédictifs avant leur validation.
  const lineup = Array.isArray(fixture.lineups) ? fixture.lineups : [];
  const known = new Map();
  for (const entry of lineup) {
    const id = Number(entry.player_id);
    if (!Number.isSafeInteger(id)) continue;
    if (Number(entry.type_id) === 11) known.set(id, 'Titulaire annoncé / probable');
    if (Number(entry.type_id) === 12) known.set(id, 'Remplaçant annoncé / probable');
  }
  return known;
}

function playerRow(squadEntry, team, lineup) {
  const details = squadEntry?.details;
  const goals = metric(details, METRICS.goals);
  const appearances = metric(details, METRICS.appearances);
  const minutes = metric(details, METRICS.minutes);
  const shots = metric(details, METRICS.shots);
  const xg = metric(details, METRICS.xg);
  const player = squadEntry?.player || {};
  const playerId = Number(squadEntry?.player_id || player?.id);
  const name = player.display_name || player.name
    || player.common_name || '';
  if (!name || !Number.isSafeInteger(playerId)) return null;

  // Poisson avec exposition au temps de jeu si les minutes sont connues.
  // C'est une probabilité CONDITIONNELLE à la participation, pas un marché
  // calibré. Sans temps de jeu attendu fiable, l'estimation est indicative.
  const usable = goals !== null && appearances !== null
    && appearances >= 5 && goals <= appearances * 3;
  const validMinutes = Number.isFinite(minutes) && minutes > 0
    && minutes <= appearances * 130;
  const averageMinutes = validMinutes
    ? Math.min(90, minutes / appearances)
    : null;
  const minutesExposure = validMinutes
    ? minutes / 90
    : appearances;
  const goalsRate = usable
    ? (goals + 0.25) / (minutesExposure + 2)
    : null;
  // Un xG de saison n'est pris en compte que s'il est plausible et
  // cohérent avec les buts et la durée jouée.
  const validXg = usable && xg !== null && xg >= 0
    && xg <= minutesExposure * 3;
  const xgRate = validXg
    ? (xg + 0.25) / (minutesExposure + 2)
    : null;
  const blendedRate = goalsRate === null ? null
    : xgRate === null ? goalsRate
    : 0.45 * goalsRate + 0.55 * xgRate;
  const lambda = blendedRate === null ? null
    : Math.max(0, Math.min(3, blendedRate *
      (averageMinutes === null ? 1 : averageMinutes / 90)));
  const cdf0 = lambda === null ? null : Math.exp(-lambda);
  const probability = lambda === null ? null
    : Math.round(100 * (1 - cdf0));
  const probability2 = lambda === null ? null
    : Math.round(100 * (1 - cdf0 * (1 + lambda)));
  const probability3 = lambda === null ? null
    : Math.round(100 * (1 - cdf0 * (1 + lambda + lambda * lambda / 2)));
  const lineupText = lineup.get(playerId) ||
    (lineup.size ? 'Présence non confirmée dans le XI disponible'
      : 'Participation à confirmer');

  return {
    playerId,
    name: String(name),
    teamId: team.id,
    team: team.name,
    goals,
    appearances,
    minutes,
    shots,
    xg,
    probability,
    probability2,
    probability3,
    averageMinutes: averageMinutes === null
      ? null : Math.round(averageMinutes),
    lambda: lambda === null ? null : Number(lambda.toFixed(4)),
    lineupStatus: lineupText,
    model: probability === null ? 'données insuffisantes'
      : validXg
        ? 'Poisson lissé buts/xG, minutes moyennes, non calibré'
        : 'Poisson lissé buts/minutes, non calibré'
  };
}

async function squadForTeam(seasonId, team, token, lineup) {
  const path = '/squads/seasons/' + seasonId + '/teams/' + team.id;
  let raw;
  let dataWarning = null;
  try {
    raw = await sportmonks(path, token, 'player;details');
  } catch (error) {
    // Certaines formules excluent les détails statistiques mais autorisent
    // encore l'effectif et les noms des joueurs.
    dataWarning = 'Statistiques indisponibles pour ' + team.name +
      ' (' + (error.status ? 'HTTP ' + error.status : 'réseau') + ')';
    try {
      raw = await sportmonks(path, token, 'player');
    } catch (fallbackError) {
      return {
        players: [],
        warning: 'Effectif inaccessible pour ' + team.name +
          ' (' + (fallbackError.status ? 'HTTP ' + fallbackError.status : 'réseau') + ')'
      };
    }
  }
  const rows = Array.isArray(raw) ? raw : [];
  return {
    players: rows.map(row => playerRow(row, team, lineup)).filter(Boolean),
    warning: dataWarning
  };
}

exports.handler = async event => {
  if ((event.httpMethod || 'GET') !== 'GET') {
    return json(405, { error: 'Méthode non autorisée' });
  }
  const value = String(event.queryStringParameters?.fixtureId || '');
  if (!/^[1-9][0-9]{0,11}$/.test(value)) {
    return json(400, { error: 'Identifiant de match invalide' });
  }
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) return json(503, { error: 'Sportmonks non configuré' });

  let fixture;
  try {
    fixture = await sportmonks('/fixtures/' + value, token,
      'participants;lineups;metadata');
  } catch (error) {
    return json(502, {
      error: 'Impossible de charger la fiche Sportmonks',
      providerStatus: error.status || null
    });
  }
  if (!fixture || !LEAGUES.has(Number(fixture.league_id))) {
    return json(404, { error: 'Match absent des cinq championnats MatchScope' });
  }
  const seasonId = Number(fixture.season_id);
  const participants = Array.isArray(fixture.participants)
    ? fixture.participants : [];
  const home = mainTeam(participants, 'home', 0);
  const away = mainTeam(participants, 'away', 1);
  if (!Number.isSafeInteger(seasonId) || !home?.id || !away?.id) {
    return json(200, {
      fixtureId: value,
      players: [],
      warnings: ['Saison ou équipes manquantes pour ce match.'],
      note: 'Aucune probabilité calculée sans données individuelles.'
    });
  }

  const knownLineups = lineupState(fixture);
  const teams = [home, away].map(team => ({
    id: Number(team.id), name: String(team.name || 'Équipe')
  }));
  const results = await Promise.all(teams.map(team =>
    squadForTeam(seasonId, team, token, knownLineups)
  ));
  const players = results.flatMap(r => r.players)
    .sort((a, b) => {
      if (a.probability === null && b.probability !== null) return 1;
      if (b.probability === null && a.probability !== null) return -1;
      if (a.probability !== b.probability)
        return (b.probability || 0) - (a.probability || 0);
      return (b.goals || 0) - (a.goals || 0);
    });
  const warnings = results.map(r => r.warning).filter(Boolean);
  if (!players.length) {
    warnings.push('Aucune statistique individuelle accessible pour ce match.');
  }
  return json(200, {
    fixtureId: value,
    leagueId: Number(fixture.league_id),
    seasonId,
    teams,
    players,
    lineupsAvailable: knownLineups.size > 0,
    estimatedCount: players.filter(p => p.probability !== null).length,
    warnings,
    methodology: 'Poisson lissé à partir des buts, minutes et xG de saison si disponibles. Les probabilités de 1+, 2+ et 3+ buts sont conditionnelles à la participation, calculées avec le temps de jeu moyen. Estimations expérimentales non calibrées, sans prise en compte de la défense adverse, du temps de jeu prévu, des blessures ni des cotes.'
  });
};
