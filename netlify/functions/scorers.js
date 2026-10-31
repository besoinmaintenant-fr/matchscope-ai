'use strict';
const { lineupStatus } = require('./lib/memory');
const { supabaseRequest } = require('./lib/supabase');

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

function lineupState(fixture, official = false) {
  // Les lineups Sportmonks peuvent être prédictifs avant leur validation.
  const lineup = Array.isArray(fixture.lineups) ? fixture.lineups : [];
  const known = new Map();
  for (const entry of lineup) {
    const id = Number(entry.player_id);
    if (!Number.isSafeInteger(id)) continue;
    if (Number(entry.type_id) === 11) known.set(id,
      official ? 'Titulaire officiel' : 'Titulaire annoncé / probable');
    if (Number(entry.type_id) === 12) known.set(id, 'Remplaçant annoncé / probable');
  }
  return known;
}

function playerRow(squadEntry, team, lineup, authorized, allowReference) {
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
  // Un pourcentage PRE-MATCH exige un XI officiel et une heure antérieure
  // au coup d'envoi. Après, seul un repère statistique distinct est possible.
  const starter = lineup.get(playerId) === 'Titulaire officiel';
  const usable = (authorized || allowReference) && starter &&
    goals !== null && appearances !== null &&
    appearances >= 5 && goals <= appearances * 3;
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
    probability: authorized ? probability : null,
    probability2: authorized ? probability2 : null,
    probability3: authorized ? probability3 : null,
    referenceProbability: allowReference && !authorized ? probability : null,
    referenceProbability2: allowReference && !authorized ? probability2 : null,
    referenceProbability3: allowReference && !authorized ? probability3 : null,
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

async function squadForTeam(seasonId, team, token, lineup, authorized, allowReference) {
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
    players: rows.map(row => playerRow(row, team, lineup, authorized, allowReference)).filter(Boolean),
    warning: dataWarning
  };
}


/**
 * Un vrai pronostic buteur est horodaté et figé AVANT le match.
 * Ne jamais transformer un repère recalculé après coup en archive pré-match.
 */
async function frozenScorers(fixtureId) {
  try {
    const data = await supabaseRequest('scorer_predictions', {
      query: '?select=sportmonks_fixture_id,kickoff_at,captured_at,model_version,players' +
        '&sportmonks_fixture_id=eq.' + fixtureId + '&limit=1'
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || !Array.isArray(row.players) ||
        !(Date.parse(row.captured_at) < Date.parse(row.kickoff_at))) return null;
    return row;
  } catch (_error) {
    // Continuer vers les indicateurs de saison si l'archive est inaccessible.
    console.warn('MatchScope scorers: archive buteurs indisponible');
    return null;
  }
}

function frozenPayload(fixtureId, row) {
  return {
    fixtureId: String(fixtureId),
    players: row.players,
    lineupsOfficial: true,
    beforeKickoff: Date.now() < Date.parse(row.kickoff_at),
    archived: true,
    frozenAt: row.captured_at,
    modelVersion: row.model_version,
    estimatedCount: row.players.filter(p => Number.isFinite(p.probability)).length,
    referenceCount: 0,
    warnings: [],
    methodology: 'Estimation indicative figée avant le coup d’envoi, non calibrée pour les paris.'
  };
}

// Si Sportmonks a cessé de renvoyer les XI, relire ceux qui furent
// officiellement enregistrés avant le match.
async function verifiedSavedLineups(fixtureId) {
  try {
    const matches = await supabaseRequest('matches', {
      query: '?select=lineups_confirmed&sportmonks_fixture_id=eq.' +
        fixtureId + '&limit=1'
    });
    if (matches?.[0]?.lineups_confirmed !== true) return null;
    const rows = await supabaseRequest('lineups', {
      query: '?select=player_id,team_id,lineup_type' +
        '&sportmonks_fixture_id=eq.' + fixtureId + '&limit=100'
    });
    if (!Array.isArray(rows)) return null;
    const teamCounts = new Map();
    for (const row of rows) {
      if (row.lineup_type !== 'starter') continue;
      const teamId = String(row.team_id);
      teamCounts.set(teamId, (teamCounts.get(teamId) || 0) + 1);
    }
    if (teamCounts.size !== 2 ||
        ![...teamCounts.values()].every(n => n === 11)) return null;
    const result = new Map();
    for (const row of rows) {
      const id = Number(row.player_id);
      if (!Number.isSafeInteger(id)) continue;
      if (row.lineup_type === 'starter') result.set(id, 'Titulaire officiel');
      if (row.lineup_type === 'substitute') result.set(id, 'Remplaçant');
    }
    return result;
  } catch (_error) {
    console.warn('MatchScope scorers: lecture des XI archivés impossible');
    return null;
  }
}

exports.handler = async event => {
  if ((event.httpMethod || 'GET') !== 'GET') {
    return json(405, { error: 'Méthode non autorisée' });
  }
  const value = String(event.queryStringParameters?.fixtureId || '');
  if (!/^[1-9][0-9]{0,11}$/.test(value)) {
    return json(400, { error: 'Identifiant de match invalide' });
  }
  // L'archive passe AVANT l'API : fonctionne aussi après le coup d'envoi
  // ou lorsque Sportmonks ne permet plus de lire le match.
  const frozen = await frozenScorers(value);
  if (frozen) return json(200, frozenPayload(value, frozen));

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

  let official = lineupStatus(fixture).official;
  let knownLineups = lineupState(fixture, official);
  if (!official || knownLineups.size < 22) {
    const storedLineups = await verifiedSavedLineups(value);
    if (storedLineups) {
      official = true;
      knownLineups = storedLineups;
    }
  }
  // Pas de pronostic rétroactif : aucun nouveau taux après kickoff.
  const kickoff = String(fixture.starting_at || '');
  const parsedKickoff = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(kickoff)
    ? Date.parse(kickoff.replace(' ', 'T') + 'Z')
    : Date.parse(kickoff);
  const beforeKickoff = Number.isFinite(parsedKickoff) &&
    Date.now() < parsedKickoff;
  const authorized = official && beforeKickoff;
  const allowReference = official && !beforeKickoff;
  const teams = [home, away].map(team => ({
    id: Number(team.id), name: String(team.name || 'Équipe')
  }));
  const results = await Promise.all(teams.map(team =>
    squadForTeam(seasonId, team, token, knownLineups, authorized, allowReference)
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

  // Des appels démarrés juste avant kickoff peuvent finir après.
  // Dans ce cas : PAS de pourcentage présenté comme pré-match.
  const endedBeforeKickoff = Number.isFinite(parsedKickoff) &&
    Date.now() < parsedKickoff;
  if (!endedBeforeKickoff) {
    for (const p of players) {
      if (p.probability === null) continue;
      p.referenceProbability = p.probability;
      p.referenceProbability2 = p.probability2;
      p.referenceProbability3 = p.probability3;
      p.probability = null;
      p.probability2 = null;
      p.probability3 = null;
    }
  }

  // Sauvegarde définitive dès la première consultation avec XI officiels.
  // L'unicité en base empêche les recalculs de modifier un pronostic figé.
  const canFreeze = official && endedBeforeKickoff &&
    players.some(p => Number.isFinite(p.probability));
  if (canFreeze) {
    try {
      const written = await supabaseRequest('scorer_predictions', {
        method: 'POST',
        query: '?on_conflict=sportmonks_fixture_id',
        body: {
          sportmonks_fixture_id: Number(value),
          kickoff_at: new Date(parsedKickoff).toISOString(),
          model_version: 'goal-rate-v1',
          players
        },
        prefer: 'resolution=ignore-duplicates,return=representation'
      });
      const row = Array.isArray(written) ? written[0] : null;
      if (!row) {
        const existing = await frozenScorers(value);
        if (existing) return json(200, frozenPayload(value, existing));
      }
    } catch (_error) {
      warnings.push('Estimation buteur non archivée : vérifie avant le coup d’envoi.');
      console.warn('MatchScope scorers: échec sauvegarde des taux pré-match');
    }
  }
  const estimatedCount = players.filter(p => Number.isFinite(p.probability)).length;
  const referenceCount = players.filter(p => Number.isFinite(p.referenceProbability)).length;
  if (!official) warnings.unshift('Compositions non vérifiées : aucun taux buteur fiable calculable.');
  if (!endedBeforeKickoff && referenceCount > 0) {
    warnings.unshift('Après kickoff : repères de saison, PAS pronostics pré-match ni paris live.');
  }
  if (!players.length) warnings.push('Statistiques individuelles indisponibles.');

  return json(200, {
    fixtureId: value,
    leagueId: Number(fixture.league_id),
    seasonId,
    teams,
    players,
    lineupsAvailable: knownLineups.size > 0,
    lineupsOfficial: official,
    beforeKickoff: endedBeforeKickoff,
    archived: false,
    estimatedCount,
    referenceCount,
    warnings,
    methodology: 'Poisson lissé sur les statistiques de saison disponibles. Le repère calculé après le coup d’envoi n’est pas une prédiction de match ni une cote pour parier en direct.'
  });
};
