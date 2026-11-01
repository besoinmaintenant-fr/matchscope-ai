const competitions = [
  {
    id: 'all',
    name: 'Tous'
  },
  {
    id: 'L1',
    name: '🇫🇷 Ligue 1'
  },
  {
    id: 'LL',
    name: '🇪🇸 La Liga'
  },
  {
    id: 'SA',
    name: '🇮🇹 Serie A'
  },
  {
    id: 'PL',
    name: '🏴 Premier League'
  },
  {
    id: 'BL',
    name: '🇩🇪 Bundesliga 1'
  }
];


const weights = [
  ['Forme pondérée', 18],
  ['xG / xGA', 20],
  ['Domicile / extérieur', 12],
  ['Compositions & absences', 18],
  ['Repos / fatigue', 8],
  ['Matchup tactique', 9],
  ['Cotes / consensus', 7],
  ['Météo / stade', 4],
  ['H2H récent', 4]
];


let selectedLeague =
  'all';

let selectedFilter =
  'all';

let currentMode =
  'live';

let historyDays =
  30;

let matches =
  [];

let loading =
  false;

let lastError =
  null;


const $ =
  selector =>
    document.querySelector(
      selector
    );


const grid =
  $('#matchGrid');

const panel =
  $('#analysisPanel');

const template =
  $('#matchTemplate');

const tabs =
  $('#leagueTabs');


// =====================================================
// OUTILS
// =====================================================

function initials(
  name = '?'
) {

  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .map(
      word =>
        word[0]
    )
    .join('')
    .slice(
      0,
      2
    )
    .toUpperCase();
}


function pct(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === '' ||
    Number.isNaN(
      Number(value)
    )
  ) {

    return '—';
  }


  return `${Math.round(
    Number(value)
  )}%`;
}


function safeArray(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


function escapeHtml(
  value = ''
) {

  return String(value)

    .replaceAll(
      '&',
      '&amp;'
    )

    .replaceAll(
      '<',
      '&lt;'
    )

    .replaceAll(
      '>',
      '&gt;'
    )

    .replaceAll(
      '"',
      '&quot;'
    )

    .replaceAll(
      "'",
      '&#039;'
    );
}


// =====================================================
// TITRE
// =====================================================

function updateTitle() {

  const title =
    $('#sectionTitle');

  const eyebrow =
    $('#sectionEyebrow');


  const competition =
    competitions.find(
      item =>
        item.id ===
        selectedLeague
    );


  if (
    currentMode ===
    'history'
  ) {

    if (eyebrow) {

      eyebrow.textContent =
        'RÉSULTATS TERMINÉS';
    }


    if (title) {

      title.textContent =

        selectedLeague ===
        'all'

          ? `Historique • ${historyDays} jours`

          : `${competition?.name || ''} • ${historyDays} jours`;
    }

  } else {

    if (eyebrow) {

      eyebrow.textContent =
        'MATCHS À ANALYSER';
    }


    if (title) {

      title.textContent =

        selectedLeague ===
        'all'

          ? 'Tous les matchs'

          : competition?.name ||
            'Compétition';
    }
  }
}


// =====================================================
// ONGLETS LIGUES
// =====================================================

function renderTabs() {

  if (!tabs) {
    return;
  }


  tabs.innerHTML =
    '';


  competitions.forEach(
    competition => {

      const button =
        document.createElement(
          'button'
        );


      button.className =
        'league-tab' +
        (
          selectedLeague ===
          competition.id
            ? ' active'
            : ''
        );


      button.textContent =
        competition.name;


      button.onclick =
        () => {

          selectedLeague =
            competition.id;


          renderTabs();

          updateTitle();

          renderMatches();
        };


      tabs.appendChild(
        button
      );
    }
  );
}


// =====================================================
// FILTRAGE
// =====================================================

// Défense côté navigateur, même si un ancien serveur renvoie des matchs finis.
function isLiveMatchVisible(match, now = Date.now()) {
  const kickoff = Number(match?.kickoffTs);
  if (!Number.isFinite(kickoff) || kickoff <= 0) return false;
  if (match?.finished === true || [5, 7, 8].includes(Number(match?.stateId))) {
    return false;
  }
  return kickoff > now - 4 * 60 * 60 * 1000;
}

function visibleMatches() {

  return matches

    .filter(
      match =>

        selectedLeague ===
        'all' ||

        match.competition ===
        selectedLeague
    )

    .filter(
      match => currentMode === 'history' || isLiveMatchVisible(match)
    )

    .filter(
      match => {

        if (
          currentMode ===
          'history'
        ) {

          return true;
        }


        if (
          selectedFilter ===
          'lineups'
        ) {

          return (
            match.official ===
            true
          );
        }


        if (selectedFilter === 'high') {
          // Filtre de couverture, jamais de certitude d'un pari.
          return match.prematchPredictionStored === true &&
            Number.isFinite(Number(match.quality)) &&
            Number(match.quality) >= 70;
        }


        return true;
      }
    );
}


// =====================================================
// MESSAGE
// =====================================================

function renderMessage(
  title,
  message
) {

  grid.innerHTML = `

    <div class="panel-card">

      <strong>
        ${escapeHtml(title)}
      </strong>

      <p>
        ${escapeHtml(message)}
      </p>

    </div>
  `;
}


// =====================================================
// HISTORIQUE
// =====================================================

function renderHistoryMatches() {

  const data =
    visibleMatches();


  if (
    !data.length
  ) {

    renderMessage(
      'Aucun match historique',
      'Aucun résultat trouvé pour cette période.'
    );

    return;
  }


  data.forEach(
    match => {

      const article =
        document.createElement(
          'article'
        );


      article.className =
        'match-card history-card';


      const homeScore =
        match?.score?.home ??
        '—';


      const awayScore =
        match?.score?.away ??
        '—';


      article.innerHTML = `

        <div class="match-card-top">

          <span class="competition">
            ${escapeHtml(
              match.competitionName ||
              'Compétition'
            )}
          </span>

          <span class="history-status">
            ● TERMINÉ
          </span>

        </div>


        <div class="fixture-row">

          <div class="mini-team">

            <span class="mini-logo">
              ${escapeHtml(
                initials(
                  match.home
                )
              )}
            </span>

            <strong>
              ${escapeHtml(
                match.home
              )}
            </strong>

          </div>


          <div class="fixture-meta">

            <strong>
              ${homeScore}
              -
              ${awayScore}
            </strong>

            <span>
              ${escapeHtml(
                match.date ||
                ''
              )}
            </span>

          </div>


          <div class="mini-team right">

            <strong>
              ${escapeHtml(
                match.away
              )}
            </strong>

            <span class="mini-logo">
              ${escapeHtml(
                initials(
                  match.away
                )
              )}
            </span>

          </div>

        </div>


        <div class="history-result">

          <div>

            <strong>
              ${escapeHtml(
                match.venue ||
                'Stade non renseigné'
              )}
            </strong>

            <div>
              ${escapeHtml(
                match.time ||
                ''
              )}
            </div>

          </div>


          <div class="result-code">
            ${escapeHtml(
              match.actualResult ||
              '—'
            )}
          </div>

        </div>
      `;




      // Une prédiction figée est consultable sans accès à Sportmonks.
      const details=document.createElement('details');
      details.className='archived-prediction';
      details.style.marginTop='12px';
      const summary=document.createElement('summary');
      summary.textContent='Voir le pronostic archivé (si disponible)';
      details.appendChild(summary);
      const content=document.createElement('div');
      content.style.padding='10px 0';
      content.textContent='Ouvre pour consulter les données figées dans Supabase.';
      details.appendChild(content);
      let loaded=false;
      details.addEventListener('toggle',async()=>{
        if(!details.open||loaded)return;
        loaded=true;
        content.textContent='Chargement de l’archive…';
        try {
          const response=await fetch('/.netlify/functions/archived-prediction?fixtureId='+encodeURIComponent(String(match.id)),{cache:'no-store'});
          if(!response.ok)throw new Error('HTTP '+response.status);
          const data=await response.json();
          if(!data.found){
            content.textContent=data.message||'Aucun pronostic archivé pour ce match.';
            return;
          }
          const p=data.probabilities;
          const toPercent=n=> (Number(n)*100).toFixed(1).replace('.',',')+' %';
          content.textContent='1 : '+toPercent(p.home)+'  •  N : '+toPercent(p.draw)+
            '  •  2 : '+toPercent(p.away)+
            (data.exactScore?'  •  Score envisagé : '+data.exactScore:'')+
            '  •  '+data.stage+' — enregistré avant le coup d’envoi ('+
            new Date(data.capturedAt).toLocaleString('fr-FR')+')';
        }catch(_){
          loaded=false;
          content.textContent='Archive temporairement inaccessible. Réessaye.';
        }
      });
      article.appendChild(details);

      grid.appendChild(
        article
      );
    }
  );
}


// =====================================================
// LIVE
// =====================================================

function renderLiveMatches() {

  const data =
    visibleMatches();


  if (
    !data.length
  ) {

    renderMessage(
      'Aucun match trouvé',
      'Aucun match ne correspond actuellement à ce filtre.'
    );

    return;
  }


  data.forEach(
    match => {

      const node =
        template
          .content
          .cloneNode(
            true
          );


      const card =
        node.querySelector(
          '.match-card'
        );


      node
        .querySelector(
          '.competition'
        )
        .textContent =
          String(
            match.competitionName ||
            'Compétition'
          )
            .toUpperCase();


      const lineupState =
        node.querySelector(
          '.lineup-state'
        );


      if (match.official === true) {
        lineupState.textContent = '● COMPOS OFFICIELLES';
        lineupState.style.color = 'var(--success)';
      } else if (match.savedDataUnavailable === true) {
        lineupState.textContent = '○ STATUT XI INDISPONIBLE';
        lineupState.style.color = 'var(--warn)';
      } else if (match.started === true) {
        lineupState.textContent = '○ COMPOS NON CONFIRMÉES';
        lineupState.style.color = 'var(--warn)';
      } else {
        lineupState.textContent = '○ COMPOS EN ATTENTE';
        lineupState.style.color = 'var(--warn)';
      }


      node
        .querySelector(
          '.home-team'
        )
        .textContent =
          match.home ||
          'Domicile';


      node
        .querySelector(
          '.away-team'
        )
        .textContent =
          match.away ||
          'Extérieur';


      node
        .querySelector(
          '.home-logo'
        )
        .textContent =
          initials(
            match.home
          );


      node
        .querySelector(
          '.away-logo'
        )
        .textContent =
          initials(
            match.away
          );


      node
        .querySelector(
          '.fixture-time'
        )
        .textContent =
          match.time ||
          '—';


      node
        .querySelector(
          '.fixture-date'
        )
        .textContent =
          match.date ||
          '—';


      node
        .querySelector(
          '.mh'
        )
        .textContent =
          pct(
            match
              ?.probs
              ?.home
          );


      node
        .querySelector(
          '.md'
        )
        .textContent =
          pct(
            match
              ?.probs
              ?.draw
          );


      node
        .querySelector(
          '.ma'
        )
        .textContent =
          pct(
            match
              ?.probs
              ?.away
          );


      // La couverture des données n'est PAS une probabilité de réussite.
      const coverage = Number(match.quality);
      node.querySelector('.confidence-chip').textContent =
        match.prematchPredictionStored === true &&
        Number.isFinite(coverage)
          ? 'COUV. ' + Math.round(coverage) + '%'
          : 'COUV. —';


      // Deux candidats BUTEURS ayant une estimation réellement figée
      // avant le coup d'envoi. Ne jamais afficher de calcul rétroactif.
      const scorerList = node.querySelector('.top-scorers-list');
      const scorerOrigin = node.querySelector('.top-scorers-origin');
      const candidates = Array.isArray(match.topScorers)
        ? match.topScorers.filter(p =>
            p && typeof p.name === 'string' &&
            Number.isFinite(Number(p.probability)) &&
            Number(p.probability) >= 0 && Number(p.probability) <= 100
          ).slice(0, 2)
        : [];
      if (scorerList) {
        if (candidates.length) {
          scorerList.innerHTML = candidates.map((p, index) =>
            '<div class="top-scorer">' +
              '<span class="top-scorer-rank">' + (index + 1) + '</span>' +
              '<span class="top-scorer-player"><strong>' +
                escapeHtml(p.name) + '</strong><small>' +
                escapeHtml(p.team || 'Équipe') + '</small></span>' +
              '<span class="top-scorer-rate">' +
                Math.round(Number(p.probability)) + '%</span>' +
            '</div>'
          ).join('');
          if (scorerOrigin) {
            scorerOrigin.textContent = match.started
              ? 'ARCHIVÉ AVANT MATCH' : 'XI OFFICIELS';
          }
        } else {
          const label = match.started
            ? 'Aucun pronostic buteur archivé avant le coup d’envoi'
            : match.official
              ? 'Estimations buteurs en cours de préparation'
              : 'En attente des compositions officielles';
          scorerList.innerHTML = '<p class="top-scorer-empty">' +
            escapeHtml(label) + '</p>';
          if (scorerOrigin) scorerOrigin.textContent = 'EN ATTENTE';
        }
      }

      const signal =
        node.querySelector(
          '.signal'
        );


      signal.textContent =
        match.prematchPredictionStored === true
          ? (match.started ? 'Pronostic pré-match archivé' : 'Pronostic pré-match enregistré')
          : match.savedDataUnavailable === true
            ? 'Analyses sauvegardées indisponibles'
            : match.started
              ? 'Aucun pronostic pré-match enregistré'
              : 'Analyse statistique en attente';


      node
        .querySelector(
          '.analyse-btn'
        )
        .onclick =
          event => {

            event.stopPropagation();

            openAnalysis(
              match.id
            );
          };


      card.onclick =
        () => {

          openAnalysis(
            match.id
          );
        };


      grid.appendChild(
        node
      );
    }
  );
}


// =====================================================
// AFFICHAGE GLOBAL
// =====================================================

function renderMatches() {

  if (
    !grid ||
    !panel
  ) {

    return;
  }


  panel.classList.add(
    'hidden'
  );


  grid.classList.remove(
    'hidden'
  );


  grid.innerHTML =
    '';


  if (
    loading
  ) {

    renderMessage(
      'Chargement…',
      currentMode === 'history'
        ? 'Récupération des matchs historiques.'
        : 'Connexion aux données Sportmonks.'
    );

    return;
  }


  if (
    lastError
  ) {

    renderMessage(
      'Données indisponibles',
      lastError
    );

    return;
  }


  if (
    currentMode ===
    'history'
  ) {

    renderHistoryMatches();

  } else {

    renderLiveMatches();
  }
}


// =====================================================
// ANALYSE MATCH LIVE
// =====================================================

function openAnalysis(
  id
) {

  const match =
    matches.find(
      item =>
        String(item.id) ===
        String(id)
    );


  if (!match) {
    return;
  }


  grid.classList.add(
    'hidden'
  );


  panel.classList.remove(
    'hidden'
  );


  window.scrollTo({
    top:0,
    behavior:'smooth'
  });


  const officialBadge =
    $('#officialBadge');


  officialBadge.textContent =
    match.official === true
      ? (match.officialSource === 'saved'
          ? 'COMPOS OFFICIELLES ENREGISTRÉES'
          : 'COMPOS OFFICIELLES')
      : match.savedDataUnavailable === true
        ? 'STATUT XI INDISPONIBLE'
        : match.started === true
          ? 'COMPOS NON CONFIRMÉES'
          : 'COMPOS EN ATTENTE';


  officialBadge.className =

    'pill ' +

    (match.official === true ? 'success' : 'warn');


  $('#qualityBadge')
    .textContent =

      match.quality !==
      null &&

      match.quality !==
      undefined

        ? `QUALITÉ DONNÉES ${match.quality}%`

        : 'QUALITÉ DONNÉES —';


  $('#homeName')
    .textContent =
      match.home ||
      'Domicile';


  $('#awayName')
    .textContent =
      match.away ||
      'Extérieur';


  $('#homeLogo')
    .textContent =
      initials(
        match.home
      );


  $('#awayLogo')
    .textContent =
      initials(
        match.away
      );


  $('#kickoff')
    .textContent =
      match.time ||
      '—';


  $('#venue')
    .textContent =
      `${match.date || '—'} • ${match.venue || 'Stade à confirmer'}`;


  $('#pHome')
    .textContent =
      pct(
        match
          ?.probs
          ?.home
      );


  $('#pDraw')
    .textContent =
      pct(
        match
          ?.probs
          ?.draw
      );


  $('#pAway')
    .textContent =
      pct(
        match
          ?.probs
          ?.away
      );


  $('#confidence')
    .textContent =
      pct(
        match.prematchPredictionStored ? match.quality : null
      );


  $('#homeFormation')
    .textContent =
      `${match.home || 'Domicile'} • ${match.formationHome || '—'}`;


  $('#awayFormation')
    .textContent =
      `${match.away || 'Extérieur'} • ${match.formationAway || '—'}`;


  const homeXI =
    safeArray(
      match.homeXI
    );


  const awayXI =
    safeArray(
      match.awayXI
    );


  $('#homeLineup')
    .innerHTML =

      (
        homeXI.length
          ? homeXI
          : ['Composition en attente']
      )
        .map(
          player =>
            `<div class="player">${escapeHtml(player)}</div>`
        )
        .join('');


  $('#awayLineup')
    .innerHTML =

      (
        awayXI.length
          ? awayXI
          : ['Composition en attente']
      )
        .map(
          player =>
            `<div class="player">${escapeHtml(player)}</div>`
        )
        .join('');


  $('#absences')
    .textContent =
      match.absences ||
      'Données blessures et suspensions en attente.';


  const factors =
    safeArray(
      match.factors
    );


  $('#factorList')
    .innerHTML =

      factors.length

        ? factors
            .map(
              item => `

                <div class="factor">

                  <div>

                    <strong>
                      ${escapeHtml(
                        item[0]
                      )}
                    </strong>

                    <p>
                      ${escapeHtml(
                        item[1]
                      )}
                    </p>

                  </div>

                  <div class="impact ${escapeHtml(
                    item[3] ||
                    'mid'
                  )}">

                    ${escapeHtml(
                      item[2]
                    )}

                  </div>

                </div>
              `
            )
            .join('')

        : `
          <div class="note-box">
            Analyse avancée en attente.
          </div>
        `;


  const markets =
    safeArray(
      match.markets
    );


  $('#marketList')
    .innerHTML =

      markets.length

        ? markets
            .map(
              item => `

                <div class="market">

                  <div>

                    <strong>
                      ${escapeHtml(
                        item[0]
                      )}
                    </strong>

                    <p>
                      ${escapeHtml(
                        item[2] ||
                        ''
                      )}
                    </p>

                  </div>

                  <div class="market-prob">

                    <b>
                      ${escapeHtml(
                        item[1]
                      )}
                    </b>

                  </div>

                </div>
              `
            )
            .join('')

        : `
          <div class="note-box">
            Probabilités en attente.
          </div>
        `;


  const context = [
    [
      'Stade',
      match.venue ||
      'À confirmer'
    ],
    [
      'Surface',
      match.surface ||
      'À confirmer'
    ],
    [
      'Météo',
      match.weather ||
      'Indisponible'
    ],
    [
      'Statut XI',
      match.official === true
        ? 'Officiel · enregistré'
        : match.started === true
          ? 'Non confirmé'
          : 'En attente'
    ]
  ];


  $('#contextList')
    .innerHTML =

      context
        .map(
          item => `

            <div class="context-item">

              <strong>
                ${escapeHtml(
                  item[0]
                )}
              </strong>

              <p>
                ${escapeHtml(
                  item[1]
                )}
              </p>

            </div>
          `
        )
        .join('');


  $('#weightBars')
    .innerHTML =

      weights
        .map(
          item => `

            <div class="weight-row">

              <span>
                ${escapeHtml(
                  item[0]
                )}
              </span>

              <div class="weight-track">

                <div
                  class="weight-fill"
                  style="width:${item[1] * 4}%"
                >
                </div>

              </div>

              <em>
                ${item[1]}%
              </em>

            </div>
          `
        )
        .join('');


  const sources =
    safeArray(
      match.sources
    );


  $('#sourceList')
    .innerHTML =

      sources.length

        ? sources
            .map(
              item => `

                <div class="source-item">

                  <strong>
                    ${escapeHtml(
                      item[0]
                    )}
                  </strong>

                  <p>
                    ${escapeHtml(
                      item[1]
                    )}
                  </p>

                </div>
              `
            )
            .join('')

        : `
          <div class="source-item">
            <strong>
              Données live
            </strong>
          </div>
        `;


  $('#modelVersion')
    .textContent =
      'Moteur live v0.4';
}


// =====================================================
// LIVE
// =====================================================

async function tryLive() {

  currentMode =
    'live';


  loading =
    true;


  lastError =
    null;


  matches =
    [];


  $('#historyControls')
    ?.classList
    .add(
      'hidden'
    );


  $('#liveFilters')
    ?.classList
    .remove(
      'hidden'
    );


  updateTitle();

  renderMatches();


  const dataMode =
    $('#dataMode');


  if (dataMode) {

    dataMode.textContent =
      'CHARGEMENT LIVE…';

    dataMode.className =
      'pill neutral';
  }


  try {

    const response =
      await fetch(
        '/.netlify/functions/fixtures',
        {
          cache: 'no-store',
          credentials: 'same-origin'
        }
      );

    // La protection SSO Netlify peut répondre 401 avant d'appeler
    // la fonction. Cette page d'erreur n'est pas nécessairement JSON.
    if (response.status === 401) {
      throw new Error(
        'Accès refusé par Netlify (HTTP 401). ' +
        'Le site exige actuellement une connexion à l’équipe Netlify. ' +
        'Ouvre MatchScope dans le navigateur où tu es connecté à Netlify, ' +
        'ou désactive cette protection dans les paramètres Netlify.'
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new Error(
        'Netlify a renvoyé une page à la place des données de matchs ' +
        '(HTTP ' + response.status + '). ' +
        'Vérifie la connexion au site et ses restrictions d’accès.'
      );
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.details ||
        data.error ||
        `Erreur ${response.status}`
      );
    }


    matches =
      Array.isArray(
        data.matches
      )
        ? data.matches
        : [];


    loading =
      false;

    if (!matches.length && data.notice) {
      const stats = data.sourceDiagnostics || {};
      const leagues = Array.isArray(stats.upstreamLeagues)
        ? stats.upstreamLeagues
        : [];
      const receivedLeagues = leagues.length
        ? leagues.map(league =>
            (league.name || 'Ligue inconnue') +
            ' [ID ' + league.id + '] : ' + league.count
          ).join(' ; ')
        : 'information indisponible';
      const plans = Array.isArray(stats.subscriptionPlans)
        ? stats.subscriptionPlans
        : [];
      const subscriptionInfo = plans.length
        ? plans.map(p =>
            p.plan + (p.category ? ' (' + p.category + ')' : '')
          ).join(' ; ')
        : 'Non communiqué';
      const leagueAccess = stats.allowedLeagues;
      const leagueAccessInfo = leagueAccess
        ? (' Accès /leagues : HTTP ' +
          (leagueAccess.httpStatus ?? '?') +
          ', ligues autorisées : ' +
          (Array.isArray(leagueAccess.leagues) &&
           leagueAccess.leagues.length
            ? leagueAccess.leagues.map(l =>
                l.name + ' [ID ' + l.id + ']'
              ).join(' ; ')
            : 'aucune liste obtenue') + '.')
        : '';
      const check = stats.referenceFixture;
      const referenceStatus = check
        ? ('Test du match Tottenham–Crystal Palace (Premier League) : HTTP ' +
          (check.httpStatus ?? '?') +
          (check.leagueId
            ? ', ligue ' + check.leagueId
            : '') + '.')
        : '';
      lastError =
        data.notice +
        ' Reçus : ' + (stats.received ?? '?') +
        ', retenus : ' + (stats.selected ?? 0) +
        ', pages : ' + (stats.pages ?? '?') + '.' +
        ' Ligues reçues : ' + receivedLeagues + '.' +
        ' Abonnement détecté pour la clé Netlify : ' +
        subscriptionInfo + '.' +
        leagueAccessInfo +
        ' ' + referenceStatus;

      if (dataMode) {
        dataMode.textContent = 'AUCUN MATCH RETOURNÉ';
        dataMode.className = 'pill warn';
      }
    } else if (dataMode) {
      dataMode.textContent = 'DONNÉES LIVE';
      dataMode.className = 'pill success';
    }


    renderMatches();


  } catch (
    error
  ) {

    loading =
      false;


    const message = String(error?.message || error);
    lastError = /string did not match the expected pattern/i.test(message)
      ? 'Le navigateur n’a pas pu accéder aux données de matchs. ' +
        'Le site est actuellement protégé par la connexion SSO de Netlify : ' +
        'vérifie que cette connexion est ouverte dans le même navigateur.'
      : message;


    if (dataMode) {

      dataMode.textContent =
        'LIVE INDISPONIBLE';

      dataMode.className =
        'pill warn';
    }


    renderMatches();
  }
}


// =====================================================
// HISTORIQUE
// =====================================================

async function tryHistory(
  days = 30
) {

  currentMode =
    'history';


  historyDays =
    days;


  loading =
    true;


  lastError =
    null;


  matches =
    [];


  $('#historyControls')
    ?.classList
    .remove(
      'hidden'
    );


  $('#liveFilters')
    ?.classList
    .add(
      'hidden'
    );


  updateTitle();

  renderMatches();


  const dataMode =
    $('#dataMode');


  if (dataMode) {

    dataMode.textContent =
      'CHARGEMENT HISTORIQUE…';

    dataMode.className =
      'pill neutral';
  }


  try {

    const response =
      await fetch(
        `/.netlify/functions/history?days=${days}`,
        {
          cache: 'no-store',
          credentials: 'same-origin'
        }
      );

    if (response.status === 401) {
      throw new Error(
        'Accès refusé par Netlify (HTTP 401) : ' +
        'connecte-toi à l’équipe Netlify dans ce navigateur.'
      );
    }
    if (!(response.headers.get('content-type') || '').includes('json')) {
      throw new Error(
        'Réponse Netlify non JSON (HTTP ' + response.status +
        '). Vérifie l’accès au site.'
      );
    }

    const data = await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.details ||
        data.error ||
        `Erreur ${response.status}`
      );
    }


    // Double garde-fou : seul le serveur peut confirmer la fin.
    // Un score 0-0 reçu pour un match futur ou en cours
    // ne doit JAMAIS apparaître comme résultat final.
    matches =
      (Array.isArray(data.matches) ? data.matches : [])
        .filter(match => {
          const ts = Number(match?.kickoffTs);
          return match?.finished === true &&
            [5, 7, 8].includes(Number(match?.stateId)) &&
            Number.isFinite(ts) && ts > 0 && ts <= Date.now();
        });


    loading =
      false;


    if (dataMode) {

      dataMode.textContent =
        `${matches.length} MATCHS • ${days}J`;

      dataMode.className =
        'pill success';
    }


    renderMatches();


  } catch (
    error
  ) {

    loading =
      false;


    lastError =
      String(
        error?.message ||
        error
      );


    if (dataMode) {

      dataMode.textContent =
        'HISTORIQUE INDISPONIBLE';

      dataMode.className =
        'pill warn';
    }


    renderMatches();
  }
}


// =====================================================
// FILTRES LIVE
// =====================================================

document
  .querySelectorAll(
    '.seg'
  )
  .forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          document
            .querySelectorAll(
              '.seg'
            )
            .forEach(
              item =>
                item.classList.remove(
                  'active'
                )
            );


          button.classList.add(
            'active'
          );


          selectedFilter =
            button.dataset.filter;


          renderMatches();
        }
      );
    }
  );


// =====================================================
// LIVE / HISTORIQUE
// =====================================================

document
  .querySelectorAll(
    '.mode-btn'
  )
  .forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          document
            .querySelectorAll(
              '.mode-btn'
            )
            .forEach(
              item =>
                item.classList.remove(
                  'active'
                )
            );


          button.classList.add(
            'active'
          );


          if (
            button.dataset.mode ===
            'history'
          ) {

            tryHistory(
              historyDays
            );

          } else {

            tryLive();
          }
        }
      );
    }
  );


// =====================================================
// 7 / 30 / 90 JOURS
// =====================================================

document
  .querySelectorAll(
    '.history-day'
  )
  .forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          document
            .querySelectorAll(
              '.history-day'
            )
            .forEach(
              item =>
                item.classList.remove(
                  'active'
                )
            );


          button.classList.add(
            'active'
          );


          tryHistory(
            Number(
              button.dataset.days
            )
          );
        }
      );
    }
  );


// La fiche buteur peut créer une archive pré-match à la demande.
// Son Top 2 apparaît au retour de l'analyse, sans recharger la page.
window.addEventListener('matchscope:scorers-ready', event => {
  const data = event.detail || {};
  if (data.archived !== true) return;
  const match = matches.find(item => String(item.id) === String(data.fixtureId));
  if (!match) return;
  const candidates = (Array.isArray(data.players) ? data.players : [])
    .filter(p => p?.lineupStatus === 'Titulaire officiel' &&
      typeof p?.name === 'string' && p.name.trim() &&
      p.probability !== null && p.probability !== undefined &&
      Number.isFinite(Number(p.probability)) &&
      Number(p.probability) >= 0 && Number(p.probability) <= 100
    )
    .sort((a,b) => Number(b.probability) - Number(a.probability))
    .slice(0, 2)
    .map(p => ({
      playerId: String(p.playerId), name: p.name,
      team: p.team || '', probability: Math.round(Number(p.probability)),
      sample: p.sampleLevel || null
    }));
  if (!candidates.length) return;
  match.topScorers = candidates;
  match.scorerPredictionStored = true;
  // Le panneau d'analyse reste ouvert ; le retour relit match.topScorers.
});

// =====================================================
// RETOUR
// =====================================================

$('#backBtn')
  ?.addEventListener(
    'click',
    () => {

      panel.classList.add(
        'hidden'
      );


      grid.classList.remove(
        'hidden'
      );


      renderMatches();
    }
  );


// =====================================================
// ACTUALISER
// =====================================================

$('#refreshBtn')
  ?.addEventListener(
    'click',
    () => {

      if (
        currentMode ===
        'history'
      ) {

        tryHistory(
          historyDays
        );

      } else {

        tryLive();
      }
    }
  );


// =====================================================
// DÉMARRAGE
// =====================================================

$('#coverageValue')
  .textContent =
    '5';


renderTabs();

updateTitle();

tryLive();
