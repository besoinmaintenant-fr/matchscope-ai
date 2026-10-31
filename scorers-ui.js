// MatchScope AI — charge les données buteurs pour la fiche du joueur sur le terrain.
// Aucun classement ni texte de statistiques n'est affiché dans la page principale.
(() => {
  if (typeof openAnalysis !== 'function') return;
  const previousOpenAnalysis = openAnalysis;
  const cache = new Map();
  const CACHE_MS = 10 * 60 * 1000;
  let serial = 0;
  let controller = null;

  function publish(fixtureId, payload) {
    window.dispatchEvent(new CustomEvent('matchscope:scorers-ready', {
      detail: {
        fixtureId: String(fixtureId),
        players: Array.isArray(payload?.players) ? payload.players : [],
        archived: payload?.archived === true,
        referenceCount: Number(payload?.referenceCount) || 0,
        estimatedCount: Number(payload?.estimatedCount) || 0
      }
    }));
  }

  async function load(fixtureId) {
    const sequence = ++serial;
    if (controller) controller.abort();
    controller = new AbortController();

    const cached = cache.get(String(fixtureId));
    if (cached && Date.now() - cached.at < CACHE_MS) {
      // Attendre que lineup-ui.js ait réinitialisé l'ID du match.
      // Sinon une archive déjà en cache est publiée trop tôt et perdue.
      await Promise.resolve();
      if (sequence === serial) publish(fixtureId, cached.data);
      return;
    }

    try {
      const response = await fetch(
        '/.netlify/functions/scorers?fixtureId=' +
          encodeURIComponent(String(fixtureId)),
        { signal: controller.signal }
      );
      const data = await response.json();
      if (sequence !== serial) return;
      if (!response.ok) throw new Error(data.error || 'Buteurs indisponibles');

      if (data.archived === true) {
        cache.set(String(fixtureId), { at: Date.now(), data });
      }
      publish(fixtureId, data);
    } catch (error) {
      if (sequence !== serial || error.name === 'AbortError') return;
      publish(fixtureId, { players: [] });
    }
  }

  openAnalysis = function (id) {
    previousOpenAnalysis(id);
    if (typeof currentMode !== 'undefined' && currentMode !== 'live') return;
    if (!/^[1-9][0-9]{0,11}$/.test(String(id))) return;
    load(id);
  };
})();
