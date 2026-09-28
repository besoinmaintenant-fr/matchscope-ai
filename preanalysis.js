// =====================================================
// MATCHSCOPE AI
// PREANALYSIS.JS
//
// Transforme l'historique Sportmonks en statistiques
// utiles avant un match LIVE.
//
// IMPORTANT :
// - aucune probabilité inventée
// - aucune prédiction 1/N/2 calculée ici
// - historique = variables descriptives uniquement
// =====================================================


(() => {

  // ---------------------------------------------------
  // VÉRIFICATION
  // ---------------------------------------------------

  if (
    typeof openAnalysis !==
    'function'
  ) {

    console.error(
      'MatchScope : openAnalysis introuvable.'
    );

    return;
  }


  // On conserve la fonction originale de app.js

  const originalOpenAnalysis =
    openAnalysis;


  let historyCache =
    null;


  let historyLoading =
    null;


  // ===================================================
  // OUTILS
  // ===================================================

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


  function normalizeTeam(
    value = ''
  ) {

    return String(value)

      .normalize('NFD')

      .replace(
        /[\u0300-\u036f]/g,
        ''
      )

      .toLowerCase()

      .replace(
        /[^a-z0-9]/g,
        ''
      );
  }


  function sameTeam(
    first,
    second
  ) {

    return (
      normalizeTeam(first) ===
      normalizeTeam(second)
    );
  }


  function number(
    value
  ) {

    const parsed =
      Number(value);


    return Number.isFinite(
      parsed
    )
      ? parsed
      : null;
  }


  // ===================================================
  // CHARGEMENT HISTORIQUE
  // ===================================================

  async function loadHistory() {

    if (
      Array.isArray(
        historyCache
      )
    ) {

      return historyCache;
    }


    if (
      historyLoading
    ) {

      return historyLoading;
    }


    historyLoading =
      fetch(
        '/.netlify/functions/history?days=90',
        {
          cache:
            'no-store'
        }
      )

        .then(
          async response => {

            let data =
              {};


            try {

              data =
                await response.json();

            } catch (
              _error
            ) {

              data =
                {};
            }


            if (
              !response.ok
            ) {

              throw new Error(

                data.details ||

                data.error ||

                `Erreur historique ${
                  response.status
                }`
              );
            }


            historyCache =

              Array.isArray(
                data.matches
              )

                ? data.matches

                : [];


            return historyCache;
          }
        )

        .finally(
          () => {

            historyLoading =
              null;
          }
        );


    return historyLoading;
  }


  // ===================================================
  // MATCHS D'UNE ÉQUIPE
  // ===================================================

  function getTeamMatches(
    history,
    team,
    competition,
    venue = 'all',
    excludeId = null
  ) {

    return history

      .filter(
        match => {

          if (
            excludeId !== null &&
            String(match.id) ===
            String(excludeId)
          ) {

            return false;
          }


          if (
            match.competition !==
            competition
          ) {

            return false;
          }


          const home =
            sameTeam(
              match.home,
              team
            );


          const away =
            sameTeam(
              match.away,
              team
            );


          if (
            venue ===
            'home'
          ) {

            return home;
          }


          if (
            venue ===
            'away'
          ) {

            return away;
          }


          return (
            home ||
            away
          );
        }
      )

      // history.js renvoie déjà
      // les matchs du plus récent
      // au plus ancien.

      .slice(
        0,
        5
      );
  }


  // ===================================================
  // RÉSUMÉ STATISTIQUE
  // ===================================================

  function summarize(
    matchList,
    team
  ) {

    const summary = {

      played: 0,

      wins: 0,

      draws: 0,

      losses: 0,

      points: 0,

      goalsFor: 0,

      goalsAgainst: 0,

      btts: 0,

      over15: 0,

      over25: 0,

      cleanSheets: 0,

      failedToScore: 0
    };


    matchList.forEach(
      match => {

        const isHome =
          sameTeam(
            match.home,
            team
          );


        const goalsFor =
          number(

            isHome

              ? match
                  ?.score
                  ?.home

              : match
                  ?.score
                  ?.away
          );


        const goalsAgainst =
          number(

            isHome

              ? match
                  ?.score
                  ?.away

              : match
                  ?.score
                  ?.home
          );


        if (
          goalsFor === null ||
          goalsAgainst === null
        ) {

          return;
        }


        summary.played +=
          1;


        summary.goalsFor +=
          goalsFor;


        summary.goalsAgainst +=
          goalsAgainst;


        // Résultat

        if (
          goalsFor >
          goalsAgainst
        ) {

          summary.wins +=
            1;

          summary.points +=
            3;

        } else if (
          goalsFor ===
          goalsAgainst
        ) {

          summary.draws +=
            1;

          summary.points +=
            1;

        } else {

          summary.losses +=
            1;
        }


        // BTTS

        if (
          goalsFor > 0 &&
          goalsAgainst > 0
        ) {

          summary.btts +=
            1;
        }


        // Over 1.5

        if (
          goalsFor +
          goalsAgainst >=
          2
        ) {

          summary.over15 +=
            1;
        }


        // Over 2.5

        if (
          goalsFor +
          goalsAgainst >=
          3
        ) {

          summary.over25 +=
            1;
        }


        // Clean sheet

        if (
          goalsAgainst ===
          0
        ) {

          summary.cleanSheets +=
            1;
        }


        // N'a pas marqué

        if (
          goalsFor ===
          0
        ) {

          summary.failedToScore +=
            1;
        }
      }
    );


    return summary;
  }


  // ===================================================
  // FORMAT
  // ===================================================

  function average(
    value,
    played
  ) {

    if (
      !played
    ) {

      return '—';
    }


    return (
      value /
      played
    )
      .toFixed(
        2
      );
  }


  function percentage(
    value,
    played
  ) {

    if (
      !played
    ) {

      return '—';
    }


    return `${
      Math.round(
        value /
        played *
        100
      )
    }%`;
  }


  function record(
    summary
  ) {

    if (
      !summary.played
    ) {

      return 'Aucune donnée';
    }


    return (
      `${summary.wins}V • ` +
      `${summary.draws}N • ` +
      `${summary.losses}D`
    );
  }


  // ===================================================
  // FORME V / N / D
  // ===================================================

  function resultForTeam(
    match,
    team
  ) {

    const isHome =
      sameTeam(
        match.home,
        team
      );


    const goalsFor =
      number(

        isHome

          ? match
              ?.score
              ?.home

          : match
              ?.score
              ?.away
      );


    const goalsAgainst =
      number(

        isHome

          ? match
              ?.score
              ?.away

          : match
              ?.score
              ?.home
      );


    if (
      goalsFor === null ||
      goalsAgainst === null
    ) {

      return {
        letter:
          '?',

        css:
          'neutral'
      };
    }


    if (
      goalsFor >
      goalsAgainst
    ) {

      return {
        letter:
          'V',

        css:
          'win'
      };
    }


    if (
      goalsFor <
      goalsAgainst
    ) {

      return {
        letter:
          'D',

        css:
          'loss'
      };
    }


    return {
      letter:
        'N',

      css:
        'draw'
    };
  }


  function renderForm(
    matchList,
    team
  ) {

    if (
      !matchList.length
    ) {

      return `
        <span
          class="form-pill neutral"
        >
          —
        </span>
      `;
    }


    return matchList

      .map(
        match => {

          const result =
            resultForTeam(
              match,
              team
            );


          return `

            <span
              class="form-pill ${
                result.css
              }"
            >
              ${
                result.letter
              }
            </span>
          `;
        }
      )

      .join('');
  }


  // ===================================================
  // DÉTAIL MATCH
  // ===================================================

  function renderRecentMatches(
    matchList,
    team
  ) {

    if (
      !matchList.length
    ) {

      return `

        <div class="recent-empty">
          Aucun match disponible
        </div>
      `;
    }


    return matchList

      .map(
        match => {

          const isHome =
            sameTeam(
              match.home,
              team
            );


          const opponent =

            isHome

              ? match.away

              : match.home;


          const goalsFor =

            isHome

              ? match
                  ?.score
                  ?.home

              : match
                  ?.score
                  ?.away;


          const goalsAgainst =

            isHome

              ? match
                  ?.score
                  ?.away

              : match
                  ?.score
                  ?.home;


          const result =
            resultForTeam(
              match,
              team
            );


          return `

            <div
              class="recent-match"
            >

              <span
                class="recent-result ${
                  result.css
                }"
              >
                ${
                  result.letter
                }
              </span>


              <div
                class="recent-opponent"
              >

                <strong>
                  ${
                    escapeHtml(
                      opponent ||
                      'Adversaire'
                    )
                  }
                </strong>

                <small>
                  ${
                    isHome
                      ? 'Domicile'
                      : 'Extérieur'
                  }
                  •
                  ${
                    escapeHtml(
                      match.date ||
                      ''
                    )
                  }
                </small>

              </div>


              <b
                class="recent-score"
              >
                ${
                  escapeHtml(
                    goalsFor ?? '—'
                  )
                }
                -
                ${
                  escapeHtml(
                    goalsAgainst ?? '—'
                  )
                }
              </b>

            </div>
          `;
        }
      )

      .join('');
  }


  // ===================================================
  // QUALITÉ ÉCHANTILLON
  // ===================================================

  function sampleQuality(
    homePlayed,
    awayPlayed
  ) {

    const minimum =
      Math.min(
        homePlayed,
        awayPlayed
      );


    if (
      minimum >= 5
    ) {

      return {

        text:
          'ÉCHANTILLON BON',

        css:
          'good',

        explanation:
          '5 matchs disponibles pour les deux équipes.'
      };
    }


    if (
      minimum >= 3
    ) {

      return {

        text:
          'ÉCHANTILLON MOYEN',

        css:
          'medium',

        explanation:
          'Les statistiques sont utiles mais l’échantillon reste limité.'
      };
    }


    return {

      text:
        'ÉCHANTILLON FAIBLE',

      css:
        'weak',

      explanation:
        'Trop peu de matchs : ne pas surinterpréter les pourcentages.'
    };
  }


  // ===================================================
  // H2H
  // ===================================================

  function getH2H(
    history,
    firstTeam,
    secondTeam,
    competition
  ) {

    return history

      .filter(
        match => {

          if (
            match.competition !==
            competition
          ) {

            return false;
          }


          const directionA =

            sameTeam(
              match.home,
              firstTeam
            ) &&

            sameTeam(
              match.away,
              secondTeam
            );


          const directionB =

            sameTeam(
              match.home,
              secondTeam
            ) &&

            sameTeam(
              match.away,
              firstTeam
            );


          return (
            directionA ||
            directionB
          );
        }
      )

      .slice(
        0,
        5
      );
  }


  // ===================================================
  // CARTE ÉQUIPE
  // ===================================================

  function teamCard(
    team,
    allMatches,
    allSummary,
    splitMatches,
    splitSummary,
    splitLabel
  ) {

    return `

      <article
        class="pre-team-card"
      >

        <header
          class="pre-team-header"
        >

          <div>

            <span
              class="pre-team-mini"
            >
              FORME RÉCENTE
            </span>

            <h4>
              ${
                escapeHtml(
                  team
                )
              }
            </h4>

          </div>


          <strong
            class="pre-record"
          >
            ${
              escapeHtml(
                record(
                  allSummary
                )
              )
            }
          </strong>

        </header>


        <div
          class="recent-form"
        >
          ${
            renderForm(
              allMatches,
              team
            )
          }
        </div>


        <div
          class="pre-stat-grid"
        >

          <div
            class="pre-stat"
          >

            <span>
              Points/match
            </span>

            <strong>
              ${
                average(
                  allSummary.points,
                  allSummary.played
                )
              }
            </strong>

          </div>


          <div
            class="pre-stat"
          >

            <span>
              Buts/match
            </span>

            <strong>
              ${
                average(
                  allSummary.goalsFor,
                  allSummary.played
                )
              }
            </strong>

          </div>


          <div
            class="pre-stat"
          >

            <span>
              Encaissés/match
            </span>

            <strong>
              ${
                average(
                  allSummary.goalsAgainst,
                  allSummary.played
                )
              }
            </strong>

          </div>


          <div
            class="pre-stat"
          >

            <span>
              BTTS
            </span>

            <strong>
              ${
                percentage(
                  allSummary.btts,
                  allSummary.played
                )
              }
            </strong>

          </div>


          <div
            class="pre-stat"
          >

            <span>
              +1,5 buts
            </span>

            <strong>
              ${
                percentage(
                  allSummary.over15,
                  allSummary.played
                )
              }
            </strong>

          </div>


          <div
            class="pre-stat"
          >

            <span>
              +2,5 buts
            </span>

            <strong>
              ${
                percentage(
                  allSummary.over25,
                  allSummary.played
                )
              }
            </strong>

          </div>


          <div
            class="pre-stat"
          >

            <span>
              Clean sheets
            </span>

            <strong>
              ${
                percentage(
                  allSummary.cleanSheets,
                  allSummary.played
                )
              }
            </strong>

          </div>


          <div
            class="pre-stat"
          >

            <span>
              Sans marquer
            </span>

            <strong>
              ${
                percentage(
                  allSummary.failedToScore,
                  allSummary.played
                )
              }
            </strong>

          </div>

        </div>


        <div
          class="split-box"
        >

          <span>
            ${
              escapeHtml(
                splitLabel
              )
            }
          </span>


          <strong>
            ${
              escapeHtml(
                record(
                  splitSummary
                )
              )
            }
          </strong>


          <small>

            ${
              splitSummary.played
            }
            match(s)

            •

            ${
              average(
                splitSummary.goalsFor,
                splitSummary.played
              )
            }
            but(s) marqué(s)/match

            •

            ${
              average(
                splitSummary.goalsAgainst,
                splitSummary.played
              )
            }
            encaissé(s)/match

          </small>

        </div>


        <details
          class="recent-details"
        >

          <summary>
            Voir les derniers matchs
          </summary>


          <div
            class="recent-list"
          >
            ${
              renderRecentMatches(
                allMatches,
                team
              )
            }
          </div>

        </details>

      </article>
    `;
  }


  // ===================================================
  // LECTURE DES DONNÉES
  // ===================================================

  function descriptiveReading(
    homeName,
    awayName,
    home,
    away
  ) {

    if (
      home.played < 2 ||
      away.played < 2
    ) {

      return `
        Échantillon insuffisant pour produire une lecture
        statistique fiable.
      `;
    }


    const homePPG =
      home.points /
      home.played;


    const awayPPG =
      away.points /
      away.played;


    const homeGF =
      home.goalsFor /
      home.played;


    const awayGF =
      away.goalsFor /
      away.played;


    const homeGA =
      home.goalsAgainst /
      home.played;


    const awayGA =
      away.goalsAgainst /
      away.played;


    const observations =
      [];


    if (
      Math.abs(
        homePPG -
        awayPPG
      ) >= 0.6
    ) {

      observations.push(

        homePPG >
        awayPPG

          ? `${homeName} présente une meilleure dynamique récente en points par match.`

          : `${awayName} présente une meilleure dynamique récente en points par match.`
      );
    }


    if (
      Math.abs(
        homeGF -
        awayGF
      ) >= 0.6
    ) {

      observations.push(

        homeGF >
        awayGF

          ? `${homeName} marque davantage sur l'échantillon récent.`

          : `${awayName} marque davantage sur l'échantillon récent.`
      );
    }


    if (
      Math.abs(
        homeGA -
        awayGA
      ) >= 0.6
    ) {

      observations.push(

        homeGA <
        awayGA

          ? `${homeName} encaisse moins de buts sur la période étudiée.`

          : `${awayName} encaisse moins de buts sur la période étudiée.`
      );
    }


    if (
      !observations.length
    ) {

      observations.push(
        'Les statistiques récentes des deux équipes sont relativement proches sur les principaux indicateurs.'
      );
    }


    return observations

      .map(
        text => `
          <li>
            ${escapeHtml(text)}
          </li>
        `
      )

      .join('');
  }


  // ===================================================
  // RENDU PRINCIPAL
  // ===================================================

  async function renderPreAnalysis(
    match
  ) {

    const container =
      document.querySelector(
        '#preMatchInsights'
      );


    if (
      !container
    ) {

      return;
    }


    // Chargement

    container.innerHTML = `

      <div
        class="section-label"
      >
        FORME & STATS AVANT-MATCH
      </div>


      <div
        class="panel-card"
      >

        <div
          class="preanalysis-loading"
        >

          <span
            class="loading-dot"
          >
          </span>

          Analyse des matchs historiques…

        </div>

      </div>
    `;


    try {

      const history =
        await loadHistory();


      // -----------------------------------------------
      // 5 derniers matchs
      // -----------------------------------------------

      const homeAllMatches =
        getTeamMatches(

          history,

          match.home,

          match.competition,

          'all',

          match.id
        );


      const awayAllMatches =
        getTeamMatches(

          history,

          match.away,

          match.competition,

          'all',

          match.id
        );


      // -----------------------------------------------
      // Domicile équipe domicile
      // -----------------------------------------------

      const homeSplitMatches =
        getTeamMatches(

          history,

          match.home,

          match.competition,

          'home',

          match.id
        );


      // -----------------------------------------------
      // Extérieur équipe extérieure
      // -----------------------------------------------

      const awaySplitMatches =
        getTeamMatches(

          history,

          match.away,

          match.competition,

          'away',

          match.id
        );


      const homeSummary =
        summarize(
          homeAllMatches,
          match.home
        );


      const awaySummary =
        summarize(
          awayAllMatches,
          match.away
        );


      const homeSplitSummary =
        summarize(
          homeSplitMatches,
          match.home
        );


      const awaySplitSummary =
        summarize(
          awaySplitMatches,
          match.away
        );


      const quality =
        sampleQuality(

          homeSummary.played,

          awaySummary.played
        );


      const h2h =
        getH2H(

          history,

          match.home,

          match.away,

          match.competition
        );


      const friendly =
        match.competition ===
        'CF1';


      // -----------------------------------------------
      // HTML
      // -----------------------------------------------

      container.innerHTML = `

        <div
          class="section-label"
        >
          FORME & STATS AVANT-MATCH
        </div>


        <div
          class="panel-card preanalysis-panel"
        >

          <div
            class="preanalysis-head"
          >

            <div>

              <strong>
                Analyse des résultats récents
              </strong>

              <p>
                Matchs terminés récupérés via
                l'historique Sportmonks.
              </p>

            </div>


            <span
              class="sample-badge ${
                quality.css
              }"
            >
              ${
                quality.text
              }
            </span>

          </div>


          <div
            class="sample-explanation"
          >
            ${
              escapeHtml(
                quality.explanation
              )
            }
          </div>


          ${
            friendly

              ? `

                <div
                  class="pre-warning"
                >

                  ⚠️ Match amical :
                  ces statistiques sont affichées
                  à titre descriptif mais ne doivent
                  pas avoir le même poids qu'un
                  championnat dans le futur modèle.

                </div>
              `

              : ''
          }


          <div
            class="pre-team-grid"
          >

            ${
              teamCard(

                match.home,

                homeAllMatches,

                homeSummary,

                homeSplitMatches,

                homeSplitSummary,

                'Performance à domicile'
              )
            }


            ${
              teamCard(

                match.away,

                awayAllMatches,

                awaySummary,

                awaySplitMatches,

                awaySplitSummary,

                'Performance à l’extérieur'
              )
            }

          </div>


          <section
            class="stat-reading"
          >

            <div
              class="stat-reading-title"
            >
              LECTURE STATISTIQUE
            </div>


            <ul>

              ${
                descriptiveReading(

                  match.home,

                  match.away,

                  homeSummary,

                  awaySummary
                )
              }

            </ul>


            <p>

              Cette lecture décrit uniquement
              l'échantillon historique.

              Elle ne constitue pas encore
              une prédiction du résultat.

            </p>

          </section>


          <div
            class="pre-comparison"
          >

            <div>

              <span>
                Matchs analysés
              </span>

              <strong>

                ${
                  homeSummary.played
                }

                /

                ${
                  awaySummary.played
                }

              </strong>

              <small>
                domicile / extérieur
              </small>

            </div>


            <div>

              <span>
                H2H trouvés
              </span>

              <strong>
                ${
                  h2h.length
                }
              </strong>

              <small>
                sur 90 jours
              </small>

            </div>


            <div>

              <span>
                Fenêtre
              </span>

              <strong>
                90 jours
              </strong>

              <small>
                historique maximum
              </small>

            </div>

          </div>


          <div
            class="pre-footnote"
          >

            ⚠️ Ces données ne sont pas encore
            converties directement en probabilités.

            Elles serviront ensuite au moteur
            MatchScope et au backtest afin de
            vérifier quelles variables améliorent
            réellement les prévisions.

          </div>

        </div>
      `;


    } catch (
      error
    ) {

      container.innerHTML = `

        <div
          class="section-label"
        >
          FORME & STATS AVANT-MATCH
        </div>


        <div
          class="panel-card"
        >

          <div
            class="pre-warning"
          >

            Impossible de charger
            les statistiques historiques.

            <br><br>

            ${
              escapeHtml(
                error?.message ||
                error
              )
            }

          </div>

        </div>
      `;
    }
  }


  // ===================================================
  // BRANCHEMENT À OPENANALYSIS
  // ===================================================

  openAnalysis =
    function (
      id
    ) {

      // La fiche normale de app.js
      originalOpenAnalysis(
        id
      );


      // uniquement mode LIVE

      if (
        typeof currentMode !==
        'undefined' &&

        currentMode !==
        'live'
      ) {

        return;
      }


      if (
        typeof matches ===
        'undefined'
      ) {

        return;
      }


      const match =
        matches.find(

          item =>

            String(
              item.id
            ) ===

            String(
              id
            )
        );


      if (
        !match
      ) {

        return;
      }


      renderPreAnalysis(
        match
      );
    };


})();
