// MatchScope — fiche buteurs, chargée uniquement à l'ouverture d'un match.
(() => {
  if (typeof openAnalysis !== 'function') return;
  const previousOpenAnalysis = openAnalysis;
  let requestNumber = 0;
  let controller = null;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const formatStat = value =>
    value === null || value === undefined ? '—' : String(value);

  function reset() {
    if ($('scorerList')) $('scorerList').innerHTML = '';
    if ($('scorerStatus'))
      $('scorerStatus').textContent = 'Chargement des joueurs et statistiques Sportmonks…';
    if ($('scorerDataState')) {
      $('scorerDataState').textContent = 'CHARGEMENT';
      $('scorerDataState').className = 'pill neutral';
    }
  }

  function draw(payload) {
    const players = Array.isArray(payload.players) ? payload.players : [];
    const estimated = players.filter(p => Number.isFinite(p.probability)).length;
    $('scorerDataState').textContent =
      estimated ? estimated + ' ESTIMATIONS' : 'STATS INCOMPLÈTES';
    $('scorerDataState').className = 'pill ' + (estimated ? 'success' : 'warn');

    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    const intro = players.length
      ? players.length + ' joueurs identifiés · ' + estimated +
        ' avec une estimation indicative · ' +
        (payload.lineupsAvailable
          ? 'Compositions disponibles (validation officielle à vérifier).'
          : 'Compositions non disponibles : titularisations inconnues.')
      : 'Aucun joueur exploitable récupéré pour ce match.';
    $('scorerStatus').textContent = [intro, ...warnings].join(' ');

    if (!players.length) {
      $('scorerList').innerHTML =
        '<p class="scorer-empty">Aucun pourcentage inventé : réessaie quand les statistiques individuelles sont disponibles.</p>';
      return;
    }

    // Le classement est global, sans cacher les effectifs d'une équipe.
    // Les joueurs sans taux mesurable restent visibles après les autres.
    $('scorerList').innerHTML = players.map(p => {
      const percentage = Number.isFinite(p.probability)
        ? escape(p.probability) + ' %'
        : '—';
      const status = String(p.lineupStatus || 'Participation à confirmer');
      const disputed = /non confirmée|à confirmer/i.test(status);
      const measures = [
        'Buts : ' + formatStat(p.goals),
        'Matchs joués : ' + formatStat(p.appearances),
        'Min. : ' + formatStat(p.minutes),
        'Tirs : ' + formatStat(p.shots),
        'xG : ' + formatStat(p.xg)
      ].join(' · ');
      return '<div class="scorer-row">' +
        '<div class="scorer-identity">' +
        '<strong>' + escape(p.name) + '</strong>' +
        '<span>' + escape(p.team) + '</span>' +
        '<small>' + escape(measures) + '</small>' +
        '<small class="' + (disputed ? 'scorer-uncertain' : '') + '">' +
          escape(status) + '</small>' +
        '</div>' +
        '<div class="scorer-rate">' +
          '<b>' + percentage + '</b>' +
          '<span>' + (percentage === '—'
            ? 'Non calculable' : 'Est. si joue') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function load(fixtureId) {
    const sequence = ++requestNumber;
    if (controller) controller.abort();
    controller = new AbortController();
    reset();

    try {
      const response = await fetch(
        '/.netlify/functions/scorers?fixtureId=' +
        encodeURIComponent(String(fixtureId)),
        { signal: controller.signal }
      );
      const data = await response.json();
      if (sequence !== requestNumber) return;
      if (!response.ok) {
        throw new Error(data.error ||
          'Statistiques buteurs indisponibles (HTTP ' + response.status + ')');
      }
      draw(data);
    } catch (error) {
      if (sequence !== requestNumber || error.name === 'AbortError') return;
      if ($('scorerDataState')) {
        $('scorerDataState').textContent = 'INDISPONIBLE';
        $('scorerDataState').className = 'pill warn';
      }
      if ($('scorerStatus')) $('scorerStatus').textContent =
        'Impossible de charger les buteurs : ' + String(error.message || error) +
        '. Les autres analyses du match restent accessibles.';
    }
  }

  openAnalysis = function (id) {
    previousOpenAnalysis(id);
    if (typeof currentMode !== 'undefined' && currentMode !== 'live') return;
    if (!/^[1-9][0-9]{0,11}$/.test(String(id))) return;
    if (!$('scorerSection')) return;
    load(id);
  };
})();
