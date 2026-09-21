function clamp(n,min=0,max=1){
  return Math.max(
    min,
    Math.min(max,n)
  );
}

function normalize3(a,b,c){

  const s=
    a+b+c || 1;

  return {
    home:a/s,
    draw:b/s,
    away:c/s
  };
}

function findFulltimePrediction(
  predictions=[]
){

  for(const p of predictions){

    const code=
      (
        p?.type?.code ||
        p?.type?.developer_name ||
        ''
      )
      .toString()
      .toLowerCase();

    const pr=
      p?.predictions;

    if(
      pr &&
      (
        code.includes('fulltime') ||
        code.includes('winner') ||
        (
          'home' in pr &&
          'draw' in pr &&
          'away' in pr
        )
      )
    ){

      const scale=
        (
          Number(pr.home)>1 ||
          Number(pr.draw)>1 ||
          Number(pr.away)>1
        )
        ? 100
        : 1;

      return normalize3(
        Number(pr.home||0)/scale,
        Number(pr.draw||0)/scale,
        Number(pr.away||0)/scale
      );
    }
  }

  return null;
}

function lineupStatus(
  lineups=[]
){

  const starters=
    lineups.filter(
      p =>
        Number(p.type_id)===11
    );

  const teamCount=
    new Set(
      starters.map(
        p=>p.team_id
      )
    ).size;

  return {
    official:
      starters.length>=22 &&
      teamCount>=2,

    starters
  };
}

function dataQuality(
  fixture
){

  let q=35;

  if(
    fixture?.participants?.length>=2
  ) q+=8;

  if(
    fixture?.venue
  ) q+=4;

  if(
    fixture?.statistics?.length
  ) q+=10;

  if(
    fixture?.xgfixture?.length
  ) q+=12;

  if(
    fixture?.predictions?.length
  ) q+=12;

  if(
    fixture?.sidelined?.length
  ) q+=5;

  if(
    fixture?.weatherreport ||
    fixture?.weatherReport
  ) q+=4;

  if(
    lineupStatus(
      fixture?.lineups||[]
    ).official
  ) q+=10;

  return Math.min(
    100,
    q
  );
}

function confidenceFromQuality(
  q,
  official,
  predictable=true
){

  let c=
    50 +
    (q-50)*0.55 +
    (official ? 7 : -3) +
    (predictable ? 3 : -8);

  return Math.round(
    clamp(
      c/100,
      .35,
      .92
    )*100
  );
}

function marketProbabilities(
  p
){

  const favorite=
    Math.max(
      p.home,
      p.away
    );

  const doubleHome=
    clamp(
      p.home+p.draw
    );

  const doubleAway=
    clamp(
      p.away+p.draw
    );

  const over15=
    clamp(
      .58 +
      Math.abs(
        p.home-p.away
      )*.18 +
      favorite*.12,
      .52,
      .84
    );

  const over25=
    clamp(
      over15-.20,
      .32,
      .68
    );

  const btts=
    clamp(
      .46 +
      (
        1-
        Math.abs(
          p.home-p.away
        )
      )*.12,
      .40,
      .67
    );

  return {
    doubleHome,
    doubleAway,
    over15,
    over25,
    btts
  };
}

function analyzeFixture(
  fixture
){

  const lu=
    lineupStatus(
      fixture?.lineups||[]
    );

  const provider=
    findFulltimePrediction(
      fixture?.predictions||[]
    );

  const probs=
    provider ||
    {
      home:.39,
      draw:.29,
      away:.32
    };

  const q=
    dataQuality(
      fixture
    );

  const predictable=
    fixture?.metadata?.predictable
    !== false;

  const confidence=
    confidenceFromQuality(
      q,
      lu.official,
      predictable
    );

  return {
    probs,
    quality:q,
    confidence,
    official:lu.official,
    markets:
      marketProbabilities(
        probs
      )
  };
}

module.exports={
  analyzeFixture,
  lineupStatus,
  dataQuality,
  findFulltimePrediction
};
