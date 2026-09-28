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
    'v0.6';


  const TARGET_BRIER =
    0.620;


  const MODEL_LEAGUES =
    new Set([
      'BL',
      'LL',
      'PL'
    ]);


  const LN2 =
    Math.log(2);


  let historyPromise =
    null;


  let tuningCache =
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


  function actualVector(
    result
  ) {

    return {

      home:
        result === '1'
          ? 1
          : 0,

      draw:
        result === 'N'
          ? 1
          : 0,

      away:
        result === '2'
          ? 1
          : 0
    };
  }


  function brier3(
    probability,
    result
  ) {

    const actual =
      actualVector(
        result
      );


    return (

      Math.pow(
        probability.home -
        actual.home,
        2
      )

      +

      Math.pow(
        probability.draw -
        actual.draw,
        2
      )

      +

      Math.pow(
        probability.away -
        actual.away,
        2
      )
    );
  }


  function bestPick(
    probability
  ) {

    return [

      [
        '1',
        probability.home
      ],

      [
        'N',
        probability.draw
      ],

      [
        '2',
        probability.away
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
  // MATCHS DE LIGUE
  // ===================================================

  function leagueMatchesBefore(
    history,
    competition,
    beforeTime
  ) {

    return history.filter(
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
          !Number.isFinite(
            time
          )
        ) {

          return false;
        }


        if (
          Number.isFinite(
            beforeTime
          ) &&
          time >=
          beforeTime
        ) {

          return false;
        }


        return (

          num(
            match?.score?.home
          ) !== null

          &&

          num(
            match?.score?.away
          ) !== null
        );
      }
    );
  }


  // ===================================================
  // MATCHS ÉQUIPE AVANT UNE DATE
  // ===================================================

  function teamMatchesBefore(
    history,
    team,
    competition,
    beforeTime = Infinity,
    venue = 'all',
    limit = 10,
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


          if (
            !Number.isFinite(
              time
            )
          ) {

            return false;
          }


          if (
            Number.isFinite(
              beforeTime
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
            matchTime(
              second
            ) || 0
          )

          -

          (
            matchTime(
              first
            ) || 0
          )
      )

      .slice(
        0,
        limit
      );
  }


  // ===================================================
  // PONDÉRATION TEMPORELLE
  // ===================================================

  function timeWeight(
    matchTs,
    referenceTs,
    halfLife
  ) {

    if (
      !Number.isFinite(
        matchTs
      ) ||
      !Number.isFinite(
        referenceTs
      )
    ) {

      return 1;
    }


    const days =
      Math.max(
        0,
        (
          referenceTs -
          matchTs
        ) / 86400000
      );


    return Math.exp(
      -LN2 *
      days /
      halfLife
    );
  }


  // ===================================================
  // RÉSUMÉ PONDÉRÉ
  // ===================================================

  function weightedSummary(
    list,
    team,
    referenceTs,
    halfLife
  ) {

    const result = {

      played:
        0,

      weight:
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


        const weight =
          timeWeight(
            matchTime(match),
            referenceTs,
            halfLife
          );


        const points =

          goalsFor >
          goalsAgainst

            ? 3

            : goalsFor ===
              goalsAgainst

              ? 1

              : 0;


        result.played +=
          1;


        result.weight +=
          weight;


        result.points +=
          points *
          weight;


        result.gf +=
          goalsFor *
          weight;


        result.ga +=
          goalsAgainst *
          weight;
      }
    );


    return result;
  }


  // ===================================================
  // BASELINE CHAMPIONNAT
  // ===================================================

  function leagueBaseline(
    history,
    competition,
    beforeTime,
    halfLife
  ) {

    const list =
      leagueMatchesBefore(
        history,
        competition,
        beforeTime
      );


    const reference =

      Number.isFinite(
        beforeTime
      )

        ? beforeTime

        : Date.now();


    let weight =
      0;


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


        const matchWeight =
          timeWeight(
            matchTime(match),
            reference,
            Math.max(
              60,
              halfLife * 2
            )
          );


        weight +=
          matchWeight;


        homeGoals +=
          home *
          matchWeight;


        awayGoals +=
          away *
          matchWeight;


        if (
          home >
          away
        ) {

          homeWins +=
            matchWeight;

        } else if (
          home ===
          away
        ) {

          draws +=
            matchWeight;

        } else {

          awayWins +=
            matchWeight;
        }
      }
    );


    const priorWeight =
      12;


    const resultPriorWeight =
      20;


    return {

      n:
        list.length,


      weightedN:
        weight,


      homeGoalAvg:

        (
          homeGoals +
          priorWeight * 1.45
        )

        /

        (
          weight +
          priorWeight
        ),


      awayGoalAvg:

        (
          awayGoals +
          priorWeight * 1.15
        )

        /

        (
          weight +
          priorWeight
        ),


      resultPrior: {

        home:

          (
            homeWins +
            resultPriorWeight * 0.44
          )

          /

          (
            weight +
            resultPriorWeight
          ),


        draw:

          (
            draws +
            resultPriorWeight * 0.28
          )

          /

          (
            weight +
            resultPriorWeight
          ),


        away:

          (
            awayWins +
            resultPriorWeight * 0.28
          )

          /

          (
            weight +
            resultPriorWeight
          )
      }
    };
  }


  // ===================================================
  // SHRINKAGE
  // ===================================================

  function shrinkRate(
    weightedSum,
    weight,
    prior,
    shrinkWeight
  ) {

    return (

      weightedSum +
      shrinkWeight *
      prior

    )

    /

    (
      weight +
      shrinkWeight
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


  // ===================================================
  // DIXON-COLES
  // ===================================================

  function dcTau(
    homeGoals,
    awayGoals,
    lambdaHome,
    lambdaAway,
    rho
  ) {

    if (
      homeGoals === 0 &&
      awayGoals === 0
    ) {

      return Math.max(
        0.01,
        1 -
        lambdaHome *
        lambdaAway *
        rho
      );
    }


    if (
      homeGoals === 1 &&
      awayGoals === 0
    ) {

      return Math.max(
        0.01,
        1 +
        lambdaAway *
        rho
      );
    }


    if (
      homeGoals === 0 &&
      awayGoals === 1
    ) {

      return Math.max(
        0.01,
        1 +
        lambdaHome *
        rho
      );
    }


    if (
      homeGoals === 1 &&
      awayGoals === 1
    ) {

      return Math.max(
        0.01,
        1 -
        rho
      );
    }


    return 1;
  }


  function dixonColesMarkets(
    lambdaHome,
    lambdaAway,
    rho
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

        const base =

          poisson(
            lambdaHome,
            homeGoals
          )

          *

          poisson(
            lambdaAway,
            awayGoals
          );


        const probability =

          base *

          dcTau(
            homeGoals,
            awayGoals,
            lambdaHome,
            lambdaAway,
            rho
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
  // TEMPÉRATURE
  // ===================================================

  function temperatureScale(
    probability,
    temperature
  ) {

    const temp =
      Math.max(
        0.5,
        temperature
      );


    const home =
      Math.pow(
        Math.max(
          1e-9,
          probability.home
        ),
        1 / temp
      );


    const draw =
      Math.pow(
        Math.max(
          1e-9,
          probability.draw
        ),
        1 / temp
      );


    const away =
      Math.pow(
        Math.max(
          1e-9,
          probability.away
        ),
        1 / temp
      );


    const total =
      home +
      draw +
      away;


    return {

      home:
        home / total,

      draw:
        draw / total,

      away:
        away / total
    };
  }


  // ===================================================
  // CALIBRATION PAR CLASSE
  // ===================================================

  function applyClassCalibration(
    probability,
    factors
  ) {

    const home =
      probability.home *
      factors.home;


    const draw =
      probability.draw *
      factors.draw;


    const away =
      probability.away *
      factors.away;


    const total =
      home +
      draw +
      away;


    return {

      home:
        home / total,

      draw:
        draw / total,

      away:
        away / total
    };
  }


  // ===================================================
  // CONSTRUCTION DU MODÈLE
  // ===================================================

  function buildModel(
    history,
    target,
    beforeTime,
    config,
    calibration = null
  ) {

    const referenceTs =

      Number.isFinite(
        beforeTime
      )

        ? beforeTime

        : Date.now();


    const baseline =
      leagueBaseline(
        history,
        target.competition,
        beforeTime,
        config.halfLife
      );


    const homeAllList =
      teamMatchesBefore(
        history,
        target.home,
        target.competition,
        beforeTime,
        'all',
        10,
        target.id
      );


    const awayAllList =
      teamMatchesBefore(
        history,
        target.away,
        target.competition,
        beforeTime,
        'all',
        10,
        target.id
      );


    const homeVenueList =
      teamMatchesBefore(
        history,
        target.home,
        target.competition,
        beforeTime,
        'home',
        8,
        target.id
      );


    const awayVenueList =
      teamMatchesBefore(
        history,
        target.away,
        target.competition,
        beforeTime,
        'away',
        8,
        target.id
      );


    const homeAll =
      weightedSummary(
        homeAllList,
        target.home,
        referenceTs,
        config.halfLife
      );


    const awayAll =
      weightedSummary(
        awayAllList,
        target.away,
        referenceTs,
        config.halfLife
      );


    const homeVenue =
      weightedSummary(
        homeVenueList,
        target.home,
        referenceTs,
        config.halfLife
      );


    const awayVenue =
      weightedSummary(
        awayVenueList,
        target.away,
        referenceTs,
        config.halfLife
      );


    const leagueTeamAvg =

      (
        baseline.homeGoalAvg +
        baseline.awayGoalAvg
      )

      /

      2;


    const homeAtkVenue =
      shrinkRate(
        homeVenue.gf,
        homeVenue.weight,
        baseline.homeGoalAvg,
        config.shrink
      );


    const awayDefVenue =
      shrinkRate(
        awayVenue.ga,
        awayVenue.weight,
        baseline.homeGoalAvg,
        config.shrink
      );


    const awayAtkVenue =
      shrinkRate(
        awayVenue.gf,
        awayVenue.weight,
        baseline.awayGoalAvg,
        config.shrink
      );


    const homeDefVenue =
      shrinkRate(
        homeVenue.ga,
        homeVenue.weight,
        baseline.awayGoalAvg,
        config.shrink
      );


    const homeAtkAll =
      shrinkRate(
        homeAll.gf,
        homeAll.weight,
        leagueTeamAvg,
        config.shrink
      );


    const awayDefAll =
      shrinkRate(
        awayAll.ga,
        awayAll.weight,
        leagueTeamAvg,
        config.shrink
      );


    const awayAtkAll =
      shrinkRate(
        awayAll.gf,
        awayAll.weight,
        leagueTeamAvg,
        config.shrink
      );


    const homeDefAll =
      shrinkRate(
        homeAll.ga,
        homeAll.weight,
        leagueTeamAvg,
        config.shrink
      );


    const venueHome =
      Math.sqrt(
        Math.max(
          0.05,
          homeAtkVenue *
          awayDefVenue
        )
      );


    const venueAway =
      Math.sqrt(
        Math.max(
          0.05,
          awayAtkVenue *
          homeDefVenue
        )
      );


    const generalHome =
      Math.sqrt(
        Math.max(
          0.05,
          homeAtkAll *
          awayDefAll
        )
      );


    const generalAway =
      Math.sqrt(
        Math.max(
          0.05,
          awayAtkAll *
          homeDefAll
        )
      );


    let lambdaHome =

      config.venueShare *
      venueHome

      +

      (
        1 -
        config.venueShare
      )

      *
      generalHome;


    let lambdaAway =

      config.venueShare *
      venueAway

      +

      (
        1 -
        config.venueShare
      )

      *
      generalAway;


    const homePPG =
      shrinkRate(
        homeAll.points,
        homeAll.weight,
        1.35,
        config.shrink
      );


    const awayPPG =
      shrinkRate(
        awayAll.points,
        awayAll.weight,
        1.35,
        config.shrink
      );


    const formDiff =
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
      config.formImpact *
      formDiff;


    lambdaAway *=

      1 -
      config.formImpact *
      formDiff;


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
      dixonColesMarkets(
        lambdaHome,
        lambdaAway,
        config.rho
      );


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
        ) / 4,
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


    const uncertaintyBlend =

      config.priorBlend

      +

      (
        1 -
        quality /
        100
      )

      *
      0.18;


    const priorBlend =
      clamp(
        uncertaintyBlend,
        0.08,
        0.45
      );


    let probability = {

      home:

        (
          1 -
          priorBlend
        )

        *
        raw.home

        +

        priorBlend *
        baseline.resultPrior.home,


      draw:

        (
          1 -
          priorBlend
        )

        *
        raw.draw

        +

        priorBlend *
        baseline.resultPrior.draw,


      away:

        (
          1 -
          priorBlend
        )

        *
        raw.away

        +

        priorBlend *
        baseline.resultPrior.away
    };


    const total =

      probability.home +
      probability.draw +
      probability.away;


    probability = {

      home:
        probability.home /
        total,

      draw:
        probability.draw /
        total,

      away:
        probability.away /
        total
    };


    probability =
      temperatureScale(
        probability,
        config.temperature
      );


    if (
      calibration
    ) {

      probability =
        applyClassCalibration(
          probability,
          calibration
        );
    }


    return {

      ...probability,


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
  // PARAMÈTRES À TESTER
  // ===================================================

  function makeCandidates() {

    const candidates =
      [];


    const halfLives =
      [
        35,
        55,
        80
      ];


    const rhos =
      [
        -0.12,
        -0.06,
        0
      ];


    const temperatures =
      [
        0.95,
        1.05
      ];


    const venueShares =
      [
        0.45,
        0.60
      ];


    halfLives.forEach(
      halfLife => {

        rhos.forEach(
          rho => {

            temperatures.forEach(
              temperature => {

                venueShares.forEach(
                  venueShare => {

                    candidates.push({

                      halfLife,

                      rho,

                      temperature,

                      venueShare,

                      shrink:
                        4,

                      formImpact:
                        0.05,

                      priorBlend:
                        0.16
                    });
                  }
                );
              }
            );
          }
        );
      }
    );


    return candidates;
  }


  // ===================================================
  // LIGNES DE PRÉDICTION
  // ===================================================

  function predictionRows(
    history,
    list,
    config,
    calibration = null
  ) {

    const rows =
      [];


    list.forEach(
      match => {

        const model =
          buildModel(
            history,
            match,
            matchTime(match),
            config,
            calibration
          );


        if (
          model.sample.homeAll < 3 ||
          model.sample.awayAll < 3 ||
          model.sample.league < 12 ||
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


        rows.push({
          match,
          model
        });
      }
    );


    return rows;
  }


  // ===================================================
  // CALIBRATION
  // ===================================================

  function fitClassCalibration(
    rows
  ) {

    if (
      !rows.length
    ) {

      return {

        home:
          1,

        draw:
          1,

        away:
          1
      };
    }


    let predictedHome =
      0;


    let predictedDraw =
      0;


    let predictedAway =
      0;


    let actualHome =
      0;


    let actualDraw =
      0;


    let actualAway =
      0;


    rows.forEach(
      ({
        match,
        model
      }) => {

        predictedHome +=
          model.home;


        predictedDraw +=
          model.draw;


        predictedAway +=
          model.away;


        if (
          match.actualResult ===
          '1'
        ) {

          actualHome +=
            1;
        }


        if (
          match.actualResult ===
          'N'
        ) {

          actualDraw +=
            1;
        }


        if (
          match.actualResult ===
          '2'
        ) {

          actualAway +=
            1;
        }
      }
    );


    const n =
      rows.length;


    const factor =
      (
        actualRate,
        predictedRate
      ) =>
        clamp(
          actualRate /
          Math.max(
            0.05,
            predictedRate
          ),
          0.88,
          1.12
        );


    return {

      home:
        factor(
          actualHome / n,
          predictedHome / n
        ),

      draw:
        factor(
          actualDraw / n,
          predictedDraw / n
        ),

      away:
        factor(
          actualAway / n,
          predictedAway / n
        )
    };
  }


  // ===================================================
  // ÉVALUATION
  // ===================================================

  function evaluateRows(
    rows,
    calibration = null
  ) {

    if (
      !rows.length
    ) {

      return {

        tested:
          0,

        accuracy:
          null,

        brier:
          null,

        referenceBrier:
          null
      };
    }


    let correct =
      0;


    let brier =
      0;


    let referenceBrier =
      0;


    rows.forEach(
      ({
        match,
        model:
          rawModel
      }) => {

        const probability =

          calibration

            ? applyClassCalibration(
                rawModel,
                calibration
              )

            : rawModel;


        if (
          bestPick(
            probability
          ) ===
          match.actualResult
        ) {

          correct +=
            1;
        }


        brier +=
          brier3(
            probability,
            match.actualResult
          );


        referenceBrier +=
          brier3(
            rawModel.baseline,
            match.actualResult
          );
      }
    );


    return {

      tested:
        rows.length,


      accuracy:
        correct /
        rows.length,


      brier:
        brier /
        rows.length,


      referenceBrier:
        referenceBrier /
        rows.length
    };
  }


  // ===================================================
  // AUTO-RÉGLAGE
  // ===================================================

  function tuneModel(
    history
  ) {

    if (
      tuningCache
    ) {

      return tuningCache;
    }


    const chronological =

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
            ) !== null

            &&

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


    const splitIndex =
      Math.max(
        1,
        Math.floor(
          chronological.length *
          0.72
        )
      );


    const tuneMatches =
      chronological.slice(
        0,
        splitIndex
      );


    const holdoutMatches =
      chronological.slice(
        splitIndex
      );


    let winner =
      null;


    makeCandidates()
      .forEach(
        config => {

          const rawTuneRows =
            predictionRows(
              history,
              tuneMatches,
              config,
              null
            );


          if (
            rawTuneRows.length <
            12
          ) {

            return;
          }


          const calibration =
            fitClassCalibration(
              rawTuneRows
            );


          const calibratedTuneRows =
            predictionRows(
              history,
              tuneMatches,
              config,
              calibration
            );


          const tuneScore =
            evaluateRows(
              calibratedTuneRows,
              null
            );


          if (
            !winner ||
            tuneScore.brier <
            winner.tune.brier
          ) {

            winner = {

              config,

              calibration,

              tune:
                tuneScore
            };
          }
        }
      );


    if (
      !winner
    ) {

      winner = {

        config: {

          halfLife:
            55,

          rho:
            -0.06,

          temperature:
            1.05,

          venueShare:
            0.55,

          shrink:
            4,

          formImpact:
            0.05,

          priorBlend:
            0.16
        },


        calibration: {

          home:
            1,

          draw:
            1,

          away:
            1
        },


        tune: {

          tested:
            0,

          brier:
            null
        }
      };
    }


    const holdoutRows =
      predictionRows(
        history,
        holdoutMatches,
        winner.config,
        winner.calibration
      );


    const holdout =
      evaluateRows(
        holdoutRows,
        null
      );


    const fullRows =
      predictionRows(
        history,
        chronological,
        winner.config,
        winner.calibration
      );


    const full =
      evaluateRows(
        fullRows,
        null
      );


    tuningCache = {

      ...winner,

      holdout,

      full,


      targetReached:

        holdout.brier !==
        null

        &&

        holdout.brier <
        TARGET_BRIER
    };


    return tuningCache;
  }


  // ===================================================
  // AFFICHAGE PRINCIPAL
  // ===================================================

  function updateMainUI(
    match,
    model
  ) {

    const set =
      (
        selector,
        value
      ) => {

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
      };


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
      `Moteur ${MODEL_VERSION} • Dixon-Coles`
    );


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
              Probabilité ${MODEL_VERSION}
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
              Probabilité ${MODEL_VERSION}
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
              ${match.home} / ${match.away}
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
  // ATTENTE PREANALYSIS
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
  // VALIDATION V0.6
  // ===================================================

  async function renderValidation(
    model,
    tuning
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


    const footnote =
      panel.querySelector(
        '.pre-footnote'
      );


    if (
      footnote
    ) {

      footnote.textContent =

        'Ces statistiques alimentent désormais le modèle probabiliste V0.6. La qualité indique la quantité de données disponibles, pas la certitude du résultat.';
    }


    const holdout =
      tuning.holdout;


    const targetText =

      tuning.targetReached

        ? 'OBJECTIF < 0,620 ATTEINT'

        : 'OBJECTIF < 0,620 PAS ENCORE ATTEINT';


    const targetColor =

      tuning.targetReached

        ? 'var(--green)'

        : 'var(--yellow)';


    const card =
      document.createElement(
        'div'
      );


    card.className =
      'model-validation-card';


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

        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:8px;
            align-items:center
          "
        >

          <strong
            style="
              font-size:10px;
              color:var(--cyan)
            "
          >
            VALIDATION INDÉPENDANTE V0.6
          </strong>


          <span
            style="
              font-size:8px;
              color:${targetColor}
            "
          >
            ${targetText}
          </span>

        </div>


        ${
          holdout.tested

            ? `

              <div
                class="pre-stat-grid"
                style="margin-top:8px"
              >

                <div class="pre-stat">

                  <span>
                    Matchs holdout
                  </span>

                  <strong>
                    ${holdout.tested}
                  </strong>

                </div>


                <div class="pre-stat">

                  <span>
                    1N2 correct
                  </span>

                  <strong>
                    ${pct(holdout.accuracy)}
                  </strong>

                </div>


                <div class="pre-stat">

                  <span>
                    Brier V0.6
                  </span>

                  <strong>

                    ${
                      holdout.brier
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
                      holdout.referenceBrier
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

                Paramètres choisis uniquement
                sur la partie ancienne de l'historique,
                puis évalués sur les matchs les plus récents
                non utilisés pour le réglage.

                C'est ce score holdout
                qui compte pour l'objectif 0,620.

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
                pour une validation indépendante.

              </p>
            `
        }

      </div>
    `;


    panel.appendChild(
      card
    );
  }


  // ===================================================
  // LANCEMENT DU MODÈLE
  // ===================================================

  async function runForMatch(
    match
  ) {

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


      const tuning =
        tuneModel(
          history
        );


      const model =
        buildModel(
          history,
          match,
          Infinity,
          tuning.config,
          tuning.calibration
        );


      updateMainUI(
        match,
        model
      );


      await renderValidation(
        model,
        tuning
      );


    } catch (
      error
    ) {

      console.error(
        'MatchScope Model V0.6:',
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
