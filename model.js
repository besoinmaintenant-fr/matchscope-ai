(() => {

  if (
    typeof openAnalysis !==
    'function'
  ) {
    return;
  }


  const previousOpenAnalysis =
    openAnalysis;


  const MODEL_VERSION =
    'v0.5';


  /*
   * Le modèle probabiliste est activé
   * uniquement sur les championnats
   * classiques pour le moment.
   *
   * On exclut :
   * - les amicaux
   * - la Super Cup
   */

  const MODEL_LEAGUES =
    new Set([
      'BL',
      'LL',
      'PL'
    ]);


  let historyPromise =
    null;


  let backtestCache =
    null;


  // ===================================================
  // OUTILS
  // ===================================================

  function clamp(
    value,
    min,
    max
  ) {

    return Math.max(
      min,
      Math.min(
        max,
        value
      )
    );
  }


  function num(
    value
  ) {

    const parsed =
      Number(
        value
      );


    return Number.isFinite(
      parsed
    )
      ? parsed
      : null;
  }


  function normalizeTeam(
    value = ''
  ) {

    return String(value)

      .normalize(
        'NFD'
      )

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


  function pct(
    probability
  ) {

    return `${
      Math.round(
        clamp(
          probability,
          0,
          1
        ) * 100
      )
    }%`;
  }


  function matchTime(
    match
  ) {

    if (
      match?.startingAt
    ) {

      const value =
        Date.parse(
          match.startingAt
        );


      if (
        Number.isFinite(
          value
        )
      ) {

        return value;
      }
    }


    const value =
      Number(
        match?.kickoffTs
      );


    return Number.isFinite(
      value
    )
      ? value
      : null;
  }


  // ===================================================
  // HISTORIQUE
  // ===================================================

  async function loadHistory() {

    if (
      !historyPromise
    ) {

      historyPromise =
        fetch(
          '/.netlify/functions/history?days=90',
          {
            cache:
              'no-store'
          }
        )

          .then(
            async response => {

              const data =
                await response.json();


              if (
                !response.ok
              ) {

                throw new Error(
                  data.details ||
                  data.error ||
                  `Erreur historique ${response.status}`
                );
              }


              return Array.isArray(
                data.matches
              )
                ? data.matches
                : [];
            }
          );
    }


    return historyPromise;
  }


  // ===================================================
  // MATCHS ANTÉRIEURS
  // ===================================================

  function teamMatchesBefore(
    history,
    team,
    competition,
    beforeTime = Infinity,
    venue = 'all',
    limit = 5,
    excludeId = null
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


          if (
            excludeId !== null &&
            String(match.id) ===
            String(excludeId)
          ) {
            return false;
          }


          const time =
            matchTime(
              match
            );


          /*
           * Protection anti fuite de données :
           * pendant le backtest,
           * aucun match futur n'est utilisé.
           */

          if (
            Number.isFinite(
              beforeTime
            ) &&
            Number.isFinite(
              time
            ) &&
            time >=
            beforeTime
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

      .sort(
        (
          first,
          second
        ) =>

          (
            matchTime(second) ||
            0
          )

          -

          (
            matchTime(first) ||
            0
          )
      )

      .slice(
        0,
        limit
      );
  }


  // ===================================================
  // STATISTIQUES ÉQUIPE
  // ===================================================

  function summarize(
    list,
    team
  ) {

    const result = {

      played:
        0,

      points:
        0,

      gf:
        0,

      ga:
        0
    };


    list.forEach(
      match => {

        const isHome =
          sameTeam(
            match.home,
            team
          );


        const goalsFor =
          num(
            isHome
              ? match?.score?.home
              : match?.score?.away
          );


        const goalsAgainst =
          num(
            isHome
              ? match?.score?.away
              : match?.score?.home
          );


        if (
          goalsFor === null ||
          goalsAgainst === null
        ) {
          return;
        }


        result.played +=
          1;


        result.gf +=
          goalsFor;


        result.ga +=
          goalsAgainst;


        result.points +=

          goalsFor >
          goalsAgainst

            ? 3

            : goalsFor ===
              goalsAgainst

              ? 1

              : 0;
      }
    );


    return result;
  }


  // ===================================================
  // MOYENNES CHAMPIONNAT
  // ===================================================

  function leagueBaseline(
    history,
    competition,
    beforeTime = Infinity
  ) {

    const list =
      history.filter(
        match => {

          if (
            match.competition !==
            competition
          ) {
            return false;
          }


          const time =
            matchTime(
              match
            );


          if (
            Number.isFinite(
              beforeTime
            ) &&
            Number.isFinite(
              time
            ) &&
            time >=
            beforeTime
          ) {
            return false;
          }


          return (
            num(
              match?.score?.home
            ) !== null &&
            num(
              match?.score?.away
            ) !== null
          );
        }
      );


    let homeGoals =
      0;

    let awayGoals =
      0;

    let homeWins =
      0;

    let draws =
      0;

    let awayWins =
      0;


    list.forEach(
      match => {

        const home =
          Number(
            match.score.home
          );


        const away =
          Number(
            match.score.away
          );


        homeGoals +=
          home;


        awayGoals +=
          away;


        if (
          home >
          away
        ) {

          homeWins +=
            1;

        } else if (
          home ===
          away
        ) {

          draws +=
            1;

        } else {

          awayWins +=
            1;
        }
      }
    );


    const n =
      list.length;


    /*
     * Priors :
     * empêchent un début de saison
     * de créer des probabilités absurdes.
     */

    return {

      n,


      homeGoalAvg:

        (
          homeGoals +
          10 * 1.45
        )

        /

        (
          n +
          10
        ),


      awayGoalAvg:

        (
          awayGoals +
          10 * 1.15
        )

        /

        (
          n +
          10
        ),


      resultPrior: {

        home:

          (
            homeWins +
            20 * 0.44
          )

          /

          (
            n +
            20
          ),


        draw:

          (
            draws +
            20 * 0.28
          )

          /

          (
            n +
            20
          ),


        away:

          (
            awayWins +
            20 * 0.28
          )

          /

          (
            n +
            20
          )
      }
    };
  }


  // ===================================================
  // RÉGULARISATION
  // ===================================================

  function shrink(
    sum,
    count,
    prior,
    weight = 4
  ) {

    return (

      sum +
      weight *
      prior

    )

    /

    (
      count +
      weight
    );
  }


  // ===================================================
  // POISSON
  // ===================================================

  function poisson(
    lambda,
    goals
  ) {

    let factorial =
      1;


    for (
      let index = 2;
      index <= goals;
      index += 1
    ) {

      factorial *=
        index;
    }


    return (

      Math.exp(
        -lambda
      )

      *

      Math.pow(
        lambda,
        goals
      )

      /

      factorial
    );
  }


  function poissonMarkets(
    lambdaHome,
    lambdaAway
  ) {

    let home =
      0;

    let draw =
      0;

    let away =
      0;

    let over15 =
      0;

    let over25 =
      0;

    let btts =
      0;

    let mass =
      0;


    for (
      let homeGoals = 0;
      homeGoals <= 8;
      homeGoals += 1
    ) {

      for (
        let awayGoals = 0;
        awayGoals <= 8;
        awayGoals += 1
      ) {

        const probability =

          poisson(
            lambdaHome,
            homeGoals
          )

          *

          poisson(
            lambdaAway,
            awayGoals
          );


        mass +=
          probability;


        if (
          homeGoals >
          awayGoals
        ) {

          home +=
            probability;

        } else if (
          homeGoals ===
          awayGoals
        ) {

          draw +=
            probability;

        } else {

          away +=
            probability;
        }


        if (
          homeGoals +
          awayGoals >=
          2
        ) {

          over15 +=
            probability;
        }


        if (
          homeGoals +
          awayGoals >=
          3
        ) {

          over25 +=
            probability;
        }


        if (
          homeGoals > 0 &&
          awayGoals > 0
        ) {

          btts +=
            probability;
        }
      }
    }


    return {

      home:
        home / mass,

      draw:
        draw / mass,

      away:
        away / mass,

      over15:
        over15 / mass,

      over25:
        over25 / mass,

      btts:
        btts / mass
    };
  }


  // ===================================================
  // MOTEUR V0.5
  // ===================================================

  function buildModel(
    history,
    target,
    beforeTime = Infinity
  ) {

    const baseline =
      leagueBaseline(
        history,
        target.competition,
        beforeTime
      );


    const homeAll =
      summarize(
        teamMatchesBefore(
          history,
          target.home,
          target.competition,
          beforeTime,
          'all',
          5,
          target.id
        ),
        target.home
      );


    const awayAll =
      summarize(
        teamMatchesBefore(
          history,
          target.away,
          target.competition,
          beforeTime,
          'all',
          5,
          target.id
        ),
        target.away
      );


    const homeVenue =
      summarize(
        teamMatchesBefore(
          history,
          target.home,
          target.competition,
          beforeTime,
          'home',
          5,
          target.id
        ),
        target.home
      );


    const awayVenue =
      summarize(
        teamMatchesBefore(
          history,
          target.away,
          target.competition,
          beforeTime,
          'away',
          5,
          target.id
        ),
        target.away
      );


    const leagueTeamGoalAvg =

      (
        baseline.homeGoalAvg +
        baseline.awayGoalAvg
      )

      /

      2;


    const homeAttackVenue =
      shrink(
        homeVenue.gf,
        homeVenue.played,
        baseline.homeGoalAvg
      );


    const awayDefVenue =
      shrink(
        awayVenue.ga,
        awayVenue.played,
        baseline.homeGoalAvg
      );


    const awayAttackVenue =
      shrink(
        awayVenue.gf,
        awayVenue.played,
        baseline.awayGoalAvg
      );


    const homeDefVenue =
      shrink(
        homeVenue.ga,
        homeVenue.played,
        baseline.awayGoalAvg
      );


    const homeAttackAll =
      shrink(
        homeAll.gf,
        homeAll.played,
        leagueTeamGoalAvg
      );


    const awayDefAll =
      shrink(
        awayAll.ga,
        awayAll.played,
        leagueTeamGoalAvg
      );


    const awayAttackAll =
      shrink(
        awayAll.gf,
        awayAll.played,
        leagueTeamGoalAvg
      );


    const homeDefAll =
      shrink(
        homeAll.ga,
        homeAll.played,
        leagueTeamGoalAvg
      );


    let lambdaHome =

      0.35 *
      homeAttackVenue

      +

      0.35 *
      awayDefVenue

      +

      0.15 *
      homeAttackAll

      +

      0.15 *
      awayDefAll;


    let lambdaAway =

      0.35 *
      awayAttackVenue

      +

      0.35 *
      homeDefVenue

      +

      0.15 *
      awayAttackAll

      +

      0.15 *
      homeDefAll;


    /*
     * Forme générale.
     * Influence volontairement limitée.
     */

    const homePPG =
      shrink(
        homeAll.points,
        homeAll.played,
        1.35
      );


    const awayPPG =
      shrink(
        awayAll.points,
        awayAll.played,
        1.35
      );


    const formDifference =
      clamp(
        (
          homePPG -
          awayPPG
        ) / 3,
        -1,
        1
      );


    lambdaHome *=
      1 +
      0.08 *
      formDifference;


    lambdaAway *=
      1 -
      0.08 *
      formDifference;


    lambdaHome =
      clamp(
        lambdaHome,
        0.30,
        3.20
      );


    lambdaAway =
      clamp(
        lambdaAway,
        0.25,
        3.00
      );


    const raw =
      poissonMarkets(
        lambdaHome,
        lambdaAway
      );


    // =================================================
    // QUALITÉ DES DONNÉES
    // =================================================

    const generalCoverage =
      clamp(
        Math.min(
          homeAll.played,
          awayAll.played
        ) / 5,
        0,
        1
      );


    const venueCoverage =
      clamp(
        Math.min(
          homeVenue.played,
          awayVenue.played
        ) / 5,
        0,
        1
      );


    const leagueCoverage =
      clamp(
        baseline.n /
        30,
        0,
        1
      );


    const quality =
      Math.round(

        35

        +

        35 *
        generalCoverage

        +

        20 *
        venueCoverage

        +

        10 *
        leagueCoverage
      );


    /*
     * Si échantillon faible :
     * retour vers la moyenne du championnat.
     */

    const alpha =
      clamp(
        0.30 +
        0.55 *
        quality /
        100,
        0.35,
        0.82
      );


    let home =

      alpha *
      raw.home

      +

      (
        1 -
        alpha
      )

      *
      baseline.resultPrior.home;


    let draw =

      alpha *
      raw.draw

      +

      (
        1 -
        alpha
      )

      *
      baseline.resultPrior.draw;


    let away =

      alpha *
      raw.away

      +

      (
        1 -
        alpha
      )

      *
      baseline.resultPrior.away;


    const total =
      home +
      draw +
      away;


    home /=
      total;

    draw /=
      total;

    away /=
      total;


    return {

      home,

      draw,

      away,


      over15:
        raw.over15,

      over25:
        raw.over25,

      btts:
        raw.btts,


      lambdaHome,

      lambdaAway,


      quality,


      sample: {

        homeAll:
          homeAll.played,

        awayAll:
          awayAll.played,

        homeVenue:
          homeVenue.played,

        awayVenue:
          awayVenue.played,

        league:
          baseline.n
      },


      baseline:
        baseline.resultPrior
    };
  }


  // ===================================================
  // BACKTEST
  // ===================================================

  function bestPick(
    model
  ) {

    return [

      [
        '1',
        model.home
      ],

      [
        'N',
        model.draw
      ],

      [
        '2',
        model.away
      ]

    ]

      .sort(
        (
          first,
          second
        ) =>
          second[1] -
          first[1]
      )[0][0];
  }


  function brier3(
    probability,
    actual
  ) {

    const y1 =
      actual === '1'
        ? 1
        : 0;


    const yN =
      actual === 'N'
        ? 1
        : 0;


    const y2 =
      actual === '2'
        ? 1
        : 0;


    return (

      Math.pow(
        probability.home -
        y1,
        2
      )

      +

      Math.pow(
        probability.draw -
        yN,
        2
      )

      +

      Math.pow(
        probability.away -
        y2,
        2
      )
    );
  }


  function runBacktest(
    history
  ) {

    if (
      backtestCache
    ) {

      return backtestCache;
    }


    /*
     * Chronologie croissante.
     * Chaque match ne voit QUE son passé.
     */

    const list =
      history

        .filter(
          match =>
            MODEL_LEAGUES.has(
              match.competition
            )
        )

        .filter(
          match =>
            Number.isFinite(
              matchTime(match)
            )
        )

        .filter(
          match =>
            num(
              match?.score?.home
            ) !== null &&
            num(
              match?.score?.away
            ) !== null
        )

        .sort(
          (
            first,
            second
          ) =>
            matchTime(first) -
            matchTime(second)
        );


    let tested =
      0;

    let correct =
      0;

    let modelBrier =
      0;

    let referenceBrier =
      0;


    list.forEach(
      match => {

        const model =
          buildModel(
            list,
            match,
            matchTime(match)
          );


        /*
         * Minimum de données avant
         * d'accepter le match dans le test.
         */

        if (
          model.sample.homeAll < 3 ||
          model.sample.awayAll < 3 ||
          model.sample.league < 12
        ) {
          return;
        }


        if (
          ![
            '1',
            'N',
            '2'
          ]
            .includes(
              match.actualResult
            )
        ) {
          return;
        }


        tested +=
          1;


        if (
          bestPick(model) ===
          match.actualResult
        ) {

          correct +=
            1;
        }


        modelBrier +=
          brier3(
            model,
            match.actualResult
          );


        referenceBrier +=
          brier3(
            model.baseline,
            match.actualResult
          );
      }
    );


    backtestCache =
      tested

        ? {

            tested,

            accuracy:
              correct /
              tested,

            brier:
              modelBrier /
              tested,

            referenceBrier:
              referenceBrier /
              tested,

            gain:

              referenceBrier > 0

                ? (
                    (
                      referenceBrier -
                      modelBrier
                    )

                    /

                    referenceBrier

                    *

                    100
                  )

                : 0
          }

        : {

            tested:
              0,

            accuracy:
              null,

            brier:
              null,

            referenceBrier:
              null,

            gain:
              null
          };


    return backtestCache;
  }


  // ===================================================
  // AFFICHAGE PROBABILITÉS
  // ===================================================

  function updateMainUI(
    match,
    model
  ) {

    function set(
      selector,
      value
    ) {

      const element =
        document.querySelector(
          selector
        );


      if (
        element
      ) {

        element.textContent =
          value;
      }
    }


    set(
      '#pHome',
      pct(
        model.home
      )
    );


    set(
      '#pDraw',
      pct(
        model.draw
      )
    );


    set(
      '#pAway',
      pct(
        model.away
      )
    );


    set(
      '#confidence',
      `${model.quality}%`
    );


    set(
      '#modelVersion',
      `Moteur ${MODEL_VERSION} • Poisson`
    );


    /*
     * Les cartes de la liste
     * peuvent maintenant retenir
     * les probabilités calculées.
     */

    match.probs = {

      home:
        model.home *
        100,

      draw:
        model.draw *
        100,

      away:
        model.away *
        100
    };


    match.modelQuality =
      model.quality;


    const badge =
      document.querySelector(
        '#qualityBadge'
      );


    if (
      badge
    ) {

      badge.textContent =
        `QUALITÉ MODÈLE ${model.quality}%`;


      badge.className =
        `pill ${
          model.quality >= 65
            ? 'success'
            : 'warn'
        }`;
    }


    // Marchés

    const markets =
      document.querySelector(
        '#marketList'
      );


    if (
      markets
    ) {

      markets.innerHTML = `

        <div class="market">

          <div>
            <strong>
              +1,5 buts
            </strong>

            <p>
              Probabilité V0.5
            </p>
          </div>

          <div class="market-prob">
            <b>
              ${pct(model.over15)}
            </b>
          </div>

        </div>


        <div class="market">

          <div>
            <strong>
              +2,5 buts
            </strong>

            <p>
              Probabilité V0.5
            </p>
          </div>

          <div class="market-prob">
            <b>
              ${pct(model.over25)}
            </b>
          </div>

        </div>


        <div class="market">

          <div>
            <strong>
              Les deux marquent
            </strong>

            <p>
              BTTS
            </p>
          </div>

          <div class="market-prob">
            <b>
              ${pct(model.btts)}
            </b>
          </div>

        </div>


        <div class="market">

          <div>
            <strong>
              Buts attendus modèle
            </strong>

            <p>
              ${match.home}
              /
              ${match.away}
            </p>
          </div>

          <div class="market-prob">

            <b>

              ${
                model.lambdaHome
                  .toFixed(
                    2
                  )
              }

              -

              ${
                model.lambdaAway
                  .toFixed(
                    2
                  )
              }

            </b>

          </div>

        </div>
      `;
    }
  }


  // ===================================================
  // ATTENDRE PREANALYSIS
  // ===================================================

  async function waitForPreanalysis() {

    for (
      let index = 0;
      index < 40;
      index += 1
    ) {

      const panel =
        document.querySelector(
          '#preMatchInsights .preanalysis-panel'
        );


      if (
        panel
      ) {

        return panel;
      }


      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            100
          )
      );
    }


    return document.querySelector(
      '#preMatchInsights .panel-card'
    );
  }


  // ===================================================
  // AFFICHAGE BACKTEST
  // ===================================================

  async function renderValidation(
    model,
    backtest
  ) {

    const panel =
      await waitForPreanalysis();


    if (
      !panel
    ) {

      return;
    }


    panel
      .querySelector(
        '.model-validation-card'
      )
      ?.remove();


    const card =
      document.createElement(
        'div'
      );


    card.className =
      'model-validation-card';


    const backtestHtml =

      backtest.tested

        ? `

          <div
            class="pre-stat-grid"
            style="margin-top:8px"
          >

            <div class="pre-stat">
              <span>
                Matchs testés
              </span>

              <strong>
                ${backtest.tested}
              </strong>
            </div>


            <div class="pre-stat">
              <span>
                1N2 correct
              </span>

              <strong>
                ${pct(backtest.accuracy)}
              </strong>
            </div>


            <div class="pre-stat">
              <span>
                Brier modèle
              </span>

              <strong>
                ${
                  backtest.brier
                    .toFixed(
                      3
                    )
                }
              </strong>
            </div>


            <div class="pre-stat">
              <span>
                Brier référence
              </span>

              <strong>
                ${
                  backtest.referenceBrier
                    .toFixed(
                      3
                    )
                }
              </strong>
            </div>

          </div>


          <p
            style="
              font-size:8px;
              color:var(--muted);
              line-height:1.45;
              margin:8px 0 0
            "
          >

            Gain Brier par rapport
            aux fréquences du championnat :

            <strong>

              ${
                backtest.gain >= 0
                  ? '+'
                  : ''
              }

              ${
                backtest.gain
                  .toFixed(
                    1
                  )
              }%

            </strong>.

            Plus le Brier est bas,
            mieux les probabilités
            sont calibrées.

          </p>
        `

        : `

          <p
            style="
              font-size:8px;
              color:var(--muted);
              line-height:1.45;
              margin:8px 0 0
            "
          >

            Pas encore assez de matchs
            antérieurs par équipe
            pour produire un backtest
            exploitable.

          </p>
        `;


    card.innerHTML = `

      <div
        style="
          margin-top:12px;
          padding:11px;
          border:1px solid rgba(0,232,107,.30);
          border-radius:8px;
          background:#071009
        "
      >

        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:8px
          "
        >

          <strong
            style="
              font-size:10px;
              color:var(--green)
            "
          >
            PROBABILITÉS ${MODEL_VERSION}
          </strong>


          <span
            style="
              font-size:8px;
              color:var(--muted)
            "
          >
            QUALITÉ ${model.quality}%
          </span>

        </div>


        <div
          class="pre-stat-grid"
          style="margin-top:8px"
        >

          <div class="pre-stat">
            <span>
              1
            </span>

            <strong>
              ${pct(model.home)}
            </strong>
          </div>


          <div class="pre-stat">
            <span>
              N
            </span>

            <strong>
              ${pct(model.draw)}
            </strong>
          </div>


          <div class="pre-stat">
            <span>
              2
            </span>

            <strong>
              ${pct(model.away)}
            </strong>
          </div>


          <div class="pre-stat">
            <span>
              Buts attendus
            </span>

            <strong>

              ${
                model.lambdaHome
                  .toFixed(
                    2
                  )
              }

              -

              ${
                model.lambdaAway
                  .toFixed(
                    2
                  )
              }

            </strong>
          </div>

        </div>

      </div>


      <div
        style="
          margin-top:9px;
          padding:11px;
          border:1px solid var(--line);
          border-radius:8px;
          background:#071009
        "
      >

        <strong
          style="
            font-size:10px;
            color:var(--cyan)
          "
        >
          BACKTEST 90 JOURS
        </strong>


        ${backtestHtml}

      </div>
    `;


    panel.appendChild(
      card
    );
  }


  // ===================================================
  // LANCEMENT
  // ===================================================

  async function runForMatch(
    match
  ) {

    /*
     * Pas de probas expérimentales
     * sur amicaux / Super Cup.
     */

    if (
      !MODEL_LEAGUES.has(
        match.competition
      )
    ) {

      return;
    }


    try {

      const history =
        await loadHistory();


      const model =
        buildModel(
          history,
          match,
          Infinity
        );


      const backtest =
        runBacktest(
          history
        );


      updateMainUI(
        match,
        model
      );


      await renderValidation(
        model,
        backtest
      );


    } catch (
      error
    ) {

      console.error(
        'MatchScope Model:',
        error
      );
    }
  }


  // ===================================================
  // CONNEXION AU BOUTON ANALYSER
  // ===================================================

  openAnalysis =
    function (
      id
    ) {

      /*
       * app.js + preanalysis.js
       * construisent d'abord la fiche.
       */

      previousOpenAnalysis(
        id
      );


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
            String(item.id) ===
            String(id)
        );


      if (
        match
      ) {

        runForMatch(
          match
        );
      }
    };


})();
