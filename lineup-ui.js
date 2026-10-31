// MatchScope AI — compositions Sportmonks vérifiées sur la fiche par match.
// Ce module se charge après app.js, prediction-ui.js et scorers-ui.js.
(() => {
  if (typeof openAnalysis !== 'function') return;

  const previousOpenAnalysis = openAnalysis;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  let activeFixtureId = null;
  let controller = null;
  let serial = 0;

  function badge(value, kind = 'warn') {
    const node = $('officialBadge');
    if (!node) return;
    node.textContent = value;
    node.className = 'pill ' + kind;
  }

  function diagnostics(message, state = 'neutral') {
    const node = $('lineupCheckStatus');
    if (!node) return;
    node.textContent = message;
    node.dataset.status = state;
  }

  function showTeam(team, side) {
    if (!team) return;
    const formation = $(side + 'Formation');
    if (formation) {
      formation.textContent =
        team.name + ' • ' + (team.formation || 'Formation non renseignée');
    }

    const container = $(side + 'Lineup');
    if (!container) return;
    const starters = Array.isArray(team.starters) ? team.starters : [];
    const bench = Array.isArray(team.bench) ? team.bench : [];
    const players = p =>
      '<div class="player">' +
      (p.jersey !== null ? '<span class="lineup-number">' +
        escape(p.jersey) + '</span> ' : '') +
      escape(p.name) +
      '</div>';

    const showStarters = starters.length
      ? starters.map(players).join('')
      : '<p class="lineup-empty">Aucun titulaire transmis par Sportmonks.</p>';
    const showBench = bench.length
      ? '<h5 class="lineup-category">Remplaçants (' + bench.length +
        ')</h5>' + bench.map(players).join('')
      : '';

    container.innerHTML =
      '<h5 class="lineup-category">Titulaires (' + starters.length +
      '/11)</h5>' + showStarters + showBench;
  }

  function show(data) {
    const teamHome = Array.isArray(data.teams)
      ? data.teams.find(t => t.side === 'home') : null;
    const teamAway = Array.isArray(data.teams)
      ? data.teams.find(t => t.side === 'away') : null;

    showTeam(teamHome, 'home');
    showTeam(teamAway, 'away');

    const checked = data.checkedAt
      ? new Date(data.checkedAt).toLocaleTimeString('fr-FR', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
        })
      : '—';
    const counts = [
      'Chelsea/Domicile : ' +
        (teamHome?.starters?.length ?? 0) + ' titulaires, ' +
        (teamHome?.bench?.length ?? 0) + ' remplaçants',
      'Extérieur : ' +
        (teamAway?.starters?.length ?? 0) + ' titulaires, ' +
        (teamAway?.bench?.length ?? 0) + ' remplaçants'
    ].join(' · ');
    const factual = 'Sportmonks HTTP ' +
      (data.providerStatus || '?') + ' · ' +
      data.playerCount + ' joueurs reçus · contrôle ' +
      checked + ' · ' + counts + '. ' +
      String(data.explanation || '');
    diagnostics(factual, data.status === 'official'
      ? 'success' : (data.status === 'not_provided' ? 'warn' : 'neutral'));

    if (data.status === 'official') {
      badge('COMPOS OFFICIELLES SPORTMONKS', 'success');
    } else if (data.status === 'predicted') {
      badge('COMPOS PROBABLES SPORTMONKS', 'neutral');
    } else if (data.status === 'partial_official') {
      badge('COMPOS OFFICIELLES PARTIELLES', 'warn');
    } else if (data.status === 'unconfirmed') {
      badge('COMPOS REÇUES NON CONFIRMÉES', 'warn');
    } else {
      badge('COMPOS NON FOURNIES', 'warn');
    }
  }

  async function load(fixtureId) {
    const requestId = ++serial;
    if (controller) controller.abort();
    controller = new AbortController();

    const button = $('lineupRefreshButton');
    if (button) {
      button.disabled = true;
      button.textContent = 'Vérification…';
    }
    diagnostics('Interrogation directe de Sportmonks pour ce match…');

    try {
      const response = await fetch(
        '/.netlify/functions/lineup-check?fixtureId=' +
        encodeURIComponent(String(fixtureId)),
        { cache: 'no-store', signal: controller.signal }
      );
      const data = await response.json();
      if (requestId !== serial) return;
      if (!response.ok) {
        const error = String(data.error || 'Réponse indisponible');
        const code = data.providerStatus
          ? ' (Sportmonks HTTP ' + data.providerStatus + ')' : '';
        throw new Error(error + code);
      }
      show(data);
    } catch (error) {
      if (requestId !== serial || error.name === 'AbortError') return;
      badge('COMPOS NON VÉRIFIÉES', 'warn');
      diagnostics(
        'Impossible de vérifier les compositions auprès de Sportmonks : ' +
        (error?.message || String(error)) +
        '. Cela ne prouve pas qu’elles sont absentes.',
        'warn'
      );
    } finally {
      if (requestId === serial && button) {
        button.disabled = false;
        button.textContent = 'Vérifier à nouveau';
      }
    }
  }

  const refreshButton = $('lineupRefreshButton');
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      if (activeFixtureId !== null) load(activeFixtureId);
    });
  }

  openAnalysis = function (id) {
    previousOpenAnalysis(id);
    if (typeof currentMode !== 'undefined' && currentMode !== 'live') {
      activeFixtureId = null;
      return;
    }
    if (!/^[1-9][0-9]{0,11}$/.test(String(id))) {
      activeFixtureId = null;
      return;
    }
    activeFixtureId = String(id);
    load(activeFixtureId);
  };
})();
