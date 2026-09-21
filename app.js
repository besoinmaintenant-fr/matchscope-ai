const competitions = [
  {id:'all',name:'Tous'},
  {id:'L1',name:'🇫🇷 Ligue 1'},
  {id:'PL',name:'🇬🇧 Premier League'},
  {id:'LL',name:'🇪🇸 La Liga'},
  {id:'BL',name:'🇩🇪 Bundesliga'},
  {id:'SA',name:'🇮🇹 Serie A'},
  {id:'UCL',name:'★ Champions League'},
  {id:'UEL',name:'◆ Europa League'}
];

const demoMatches = [
  {
    id:'demo-1',competition:'L1',competitionName:'Ligue 1',date:'10 oct.',time:'20:45',
    home:'Lorient',away:'Paris FC',venue:'Stade du Moustoir',surface:'Hybride',weather:'14°C • vent 18 km/h • faible risque de pluie',
    official:false,quality:78,probs:{home:31,draw:29,away:40},confidence:74,
    formationHome:'3-4-2-1',formationAway:'4-2-3-1',
    homeXI:['Gardien probable','Piston droit probable','DC droit probable','DC probable','DC gauche probable','Piston gauche probable','Milieu probable','Milieu probable','10 probable','10 probable','Avant-centre probable'],
    awayXI:['Trapp','Camara','Coppola','Mbow','Traoré','Maxime Lopez','Lees-Melou','Kebbal','Pagis','Koleosho','Sinayoko'],
    absences:'Mode démo : les blessures/suspensions seront récupérées en direct avec la donnée « sidelined ». Les XI probables sont remplacés automatiquement par les XI officiels lorsqu’ils sortent.',
    factors:[
      ['Forme récente','Paris FC arrive avec une dynamique plus régulière sur les derniers matchs pondérés.','+8','pos'],
      ['Domicile / extérieur','Lorient récupère un bonus domicile, mais Paris voyage mieux qu’en début de saison.','+2 Lorient','mid'],
      ['xG ajustés','La production d’occasions parisienne est supérieure à sa moyenne de saison récente.','+6','pos'],
      ['Compositions','XI officiel non publié : confiance volontairement plafonnée.','−6','neg'],
      ['Fatigue & calendrier','Pas de surcharge européenne immédiate détectée dans ce scénario.','Neutre','mid']
    ],
    markets:[['1X2 — Paris FC','40%','modéré'],['Paris ou nul (X2)','69%','fort'],['+1,5 buts','76%','fort'],['+2,5 buts','52%','moyen'],['BTTS — Oui','55%','moyen']],
    sources:[['Sportmonks Football API','Fixtures, stats, xG, lineups, absents, prédictions et cotes.','Principal'],['Open‑Meteo','Prévisions et historique météo au stade.','Contexte'],['Catalogue stades','Surface, altitude et dimensions lorsque disponibles.','Faible poids']]
  },
  {
    id:'demo-2',competition:'PL',competitionName:'Premier League',date:'11 oct.',time:'17:30',
    home:'Arsenal',away:'Liverpool',venue:'Emirates Stadium',surface:'Hybride',weather:'12°C • sec',official:true,quality:94,
    probs:{home:43,draw:27,away:30},confidence:82,
    formationHome:'4-3-3',formationAway:'4-2-3-1',
    homeXI:['Raya','Défenseur 2','Défenseur 3','Défenseur 4','Défenseur 5','Milieu 6','Milieu 8','Milieu 10','Ailier D','Avant-centre','Ailier G'],
    awayXI:['Gardien','Défenseur 2','Défenseur 3','Défenseur 4','Défenseur 5','Milieu 6','Milieu 8','Ailier D','10','Ailier G','Avant-centre'],
    absences:'Démo de structure : en mode réel, cette zone liste blessés, suspendus, retours et impact individuel estimé.',
    factors:[['Compositions officielles','Les XI sont confirmés : le modèle retire l’incertitude de sélection.','+7','pos'],['Force xG','Arsenal crée légèrement plus de danger à domicile.','+4','pos'],['Transitions','Liverpool reste dangereux dès récupération haute.','−2','neg'],['Repos','Écart de repos faible.','Neutre','mid'],['Marché','Les probabilités internes restent proches du consensus des cotes.','Stable','mid']],
    markets:[['1X2 — Arsenal','43%','moyen'],['Arsenal ou nul (1X)','70%','fort'],['+2,5 buts','61%','fort'],['BTTS — Oui','64%','fort']],
    sources:[['Sportmonks Football API','Compos, xG, statistiques, absences, tendances et cotes.','Principal'],['Open‑Meteo','Météo de match.','Contexte']]
  },
  {
    id:'demo-3',competition:'LL',competitionName:'La Liga',date:'11 oct.',time:'21:00',home:'Atlético',away:'Villarreal',venue:'Metropolitano',surface:'Hybride',weather:'18°C • sec',official:false,quality:81,probs:{home:52,draw:27,away:21},confidence:76,formationHome:'4-4-2',formationAway:'4-3-3',homeXI:Array(11).fill('Titulaire probable'),awayXI:Array(11).fill('Titulaire probable'),absences:'XI non officiels : la probabilité sera recalculée à publication des compositions.',factors:[['Avantage domicile','Historique récent domicile favorable.','+6','pos'],['xGA','Atlético concède peu d’occasions franches.','+5','pos'],['Compositions','Encore probables.','−5','neg']],markets:[['1X2 — Atlético','52%','moyen'],['1X','79%','fort'],['-3,5 buts','72%','fort']],sources:[['Sportmonks Football API','Données match et modèles.','Principal']]},
  {
    id:'demo-4',competition:'BL',competitionName:'Bundesliga',date:'12 oct.',time:'15:30',home:'Leverkusen',away:'Dortmund',venue:'BayArena',surface:'Hybride',weather:'13°C • nuageux',official:true,quality:91,probs:{home:46,draw:25,away:29},confidence:79,formationHome:'3-4-2-1',formationAway:'4-2-3-1',homeXI:Array(11).fill('Titulaire officiel'),awayXI:Array(11).fill('Titulaire officiel'),absences:'Compositions officielles intégrées dans cette démo.',factors:[['XI officiel','Incertaines de sélection supprimées.','+7','pos'],['Rythme','Match à haute intensité attendu.','BTTS +','pos'],['Transition adverse','Dortmund dangereux en espace.','−3','neg']],markets:[['1X','71%','fort'],['+2,5 buts','66%','fort'],['BTTS Oui','68%','fort']],sources:[['Sportmonks Football API','Données complètes.','Principal']]},
  {
    id:'demo-5',competition:'SA',competitionName:'Serie A',date:'12 oct.',time:'20:45',home:'Inter',away:'Roma',venue:'San Siro',surface:'Hybride',weather:'15°C • sec',official:false,quality:84,probs:{home:55,draw:26,away:19},confidence:77,formationHome:'3-5-2',formationAway:'3-4-2-1',homeXI:Array(11).fill('Probable'),awayXI:Array(11).fill('Probable'),absences:'Mode démo.',factors:[['Domicile','Bonus net à l’Inter.','+6','pos'],['xG différentiel','Différentiel favorable.','+7','pos'],['XI','Non confirmé.','−5','neg']],markets:[['1X','81%','fort'],['Inter DNB','74%','fort'],['-4,5 buts','86%','fort']],sources:[['Sportmonks Football API','Données principales.','Principal']]},
  {
    id:'demo-6',competition:'UCL',competitionName:'Champions League',date:'14 oct.',time:'21:00',home:'PSG',away:'Bayern',venue:'Parc des Princes',surface:'Hybride',weather:'14°C • sec',official:true,quality:96,probs:{home:39,draw:27,away:34},confidence:84,formationHome:'4-3-3',formationAway:'4-2-3-1',homeXI:Array(11).fill('Titulaire officiel'),awayXI:Array(11).fill('Titulaire officiel'),absences:'Compositions confirmées — confiance données élevée.',factors:[['Niveau équipes','Écart faible.','Équilibré','mid'],['Compos','Officielles.','+7','pos'],['xG offensif','Deux attaques de haut niveau.','Buts +','pos']],markets:[['1X','66%','moyen'],['+2,5 buts','65%','fort'],['BTTS Oui','67%','fort']],sources:[['Sportmonks Football API','Données UCL, xG, lineups, odds.','Principal']]},
  {
    id:'demo-7',competition:'UEL',competitionName:'Europa League',date:'15 oct.',time:'18:45',home:'Roma',away:'Porto',venue:'Stadio Olimpico',surface:'Hybride',weather:'17°C • sec',official:false,quality:79,probs:{home:44,draw:30,away:26},confidence:72,formationHome:'3-4-2-1',formationAway:'4-3-3',homeXI:Array(11).fill('Probable'),awayXI:Array(11).fill('Probable'),absences:'XI encore probables.',factors:[['Domicile','Roma bénéficie du contexte.','+4','pos'],['Historique européen','Poids limité pour éviter le sur-apprentissage.','+1','mid'],['XI','Non confirmés.','−6','neg']],markets:[['1X','74%','fort'],['-3,5 buts','70%','fort'],['BTTS Oui','51%','moyen']],sources:[['Sportmonks Football API','Données Europa League.','Principal']]}
];

const weights = [
  ['Forme pondérée',18],['xG / xGA',20],['Domicile / extérieur',12],['Compositions & absences',18],['Repos / fatigue',8],['Matchup tactique',9],['Cotes / consensus marché',7],['Météo / pelouse / stade',4],['H2H récent',4]
];

let selectedLeague='all';
let selectedFilter='all';
let matches=[...demoMatches];

const $=s=>document.querySelector(s);
const tabs=$('#leagueTabs'), grid=$('#matchGrid'), template=$('#matchTemplate'), panel=$('#analysisPanel');

function initials(name){return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function pct(v){return `${Math.round(v)}%`}
function confidenceText(v){return v>=80?'Très forte':v>=70?'Forte':v>=60?'Moyenne':'Faible'}

function renderTabs(){
  tabs.innerHTML='';
  competitions.forEach(c=>{
    const b=document.createElement('button'); b.className='league-tab'+(c.id===selectedLeague?' active':''); b.textContent=c.name;
    b.onclick=()=>{selectedLeague=c.id; renderTabs(); renderMatches(); $('#sectionTitle').textContent=c.id==='all'?'Tous les matchs':c.name.replace(/^..\s/,'');};
    tabs.appendChild(b);
  });
}

function visibleMatches(){
  return matches.filter(m=>selectedLeague==='all'||m.competition===selectedLeague).filter(m=>{
    if(selectedFilter==='lineups') return m.official;
    if(selectedFilter==='high') return m.confidence>=70;
    return true;
  });
}

function renderMatches(){
  grid.innerHTML=''; panel.classList.add('hidden'); grid.classList.remove('hidden');
  const data=visibleMatches();
  if(!data.length){grid.innerHTML='<div class="panel-card">Aucun match pour ce filtre.</div>';return}
  data.forEach(m=>{
    const node=template.content.cloneNode(true); const card=node.querySelector('.match-card');
    node.querySelector('.competition').textContent=m.competitionName.toUpperCase();
    const ls=node.querySelector('.lineup-state'); ls.textContent=m.official?'● COMPOS OFFICIELLES':'○ COMPOS PROBABLES'; ls.style.color=m.official?'var(--success)':'var(--warn)';
    node.querySelector('.home-team').textContent=m.home; node.querySelector('.away-team').textContent=m.away;
    node.querySelector('.home-logo').textContent=initials(m.home); node.querySelector('.away-logo').textContent=initials(m.away);
    node.querySelector('.fixture-time').textContent=m.time; node.querySelector('.fixture-date').textContent=m.date;
    node.querySelector('.mh').textContent=pct(m.probs.home); node.querySelector('.md').textContent=pct(m.probs.draw); node.querySelector('.ma').textContent=pct(m.probs.away);
    node.querySelector('.confidence-chip').textContent=`CONF. ${m.confidence}%`;
    node.querySelector('.signal').textContent=m.confidence>=80?'Signal modèle solide':m.confidence>=70?'Signal exploitable':'À confirmer';
    node.querySelector('.analyse-btn').onclick=()=>openAnalysis(m.id);
    card.onclick=e=>{if(!e.target.closest('button')) openAnalysis(m.id)};
    grid.appendChild(node);
  });
}

function openAnalysis(id){
  const m=matches.find(x=>x.id===id); if(!m)return;
  grid.classList.add('hidden'); panel.classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'});
  $('#officialBadge').textContent=m.official?'COMPOS OFFICIELLES':'COMPOS PROBABLES'; $('#officialBadge').className='pill '+(m.official?'success':'warn');
  $('#qualityBadge').textContent=`QUALITÉ DONNÉES ${m.quality}%`;
  $('#homeName').textContent=m.home; $('#awayName').textContent=m.away; $('#homeLogo').textContent=initials(m.home); $('#awayLogo').textContent=initials(m.away);
  $('#kickoff').textContent=m.time; $('#venue').textContent=`${m.date} • ${m.venue}`;
  $('#pHome').textContent=pct(m.probs.home); $('#pDraw').textContent=pct(m.probs.draw); $('#pAway').textContent=pct(m.probs.away); $('#confidence').textContent=pct(m.confidence);
  $('#homeFormation').textContent=`${m.home} • ${m.formationHome}`; $('#awayFormation').textContent=`${m.away} • ${m.formationAway}`;
  $('#homeLineup').innerHTML=m.homeXI.map(x=>`<div class="player">${x}</div>`).join(''); $('#awayLineup').innerHTML=m.awayXI.map(x=>`<div class="player">${x}</div>`).join(''); $('#absences').textContent=m.absences;
  $('#factorList').innerHTML=m.factors.map(([t,d,i,c])=>`<div class="factor"><div><strong>${t}</strong><p>${d}</p></div><div class="impact ${c}">${i}</div></div>`).join('');
  $('#marketList').innerHTML=m.markets.map(([n,p,s])=>`<div class="market"><div><strong>${n}</strong><p>Niveau : ${s}</p></div><div class="market-prob"><b>${p}</b><span>probabilité</span></div></div>`).join('');
  const context=[['Stade',m.venue],['Surface',m.surface],['Météo',m.weather],['Confiance',`${m.confidence}% — ${confidenceText(m.confidence)}`],['Statut XI',m.official?'Officiel':'Probable — recalcul prévu']];
  $('#contextList').innerHTML=context.map(([a,b])=>`<div class="context-item"><strong>${a}</strong><p>${b}</p></div>`).join('');
  $('#weightBars').innerHTML=weights.map(([n,w])=>`<div class="weight-row"><span>${n}</span><div class="weight-track"><div class="weight-fill" style="width:${w*4}%"></div></div><em>${w}%</em></div>`).join('');
  $('#sourceList').innerHTML=m.sources.map(([n,d,r])=>`<div class="source-item"><strong>${n} <span class="tiny">• ${r}</span></strong><p>${d}</p></div>`).join('');
}

async function tryLive(){
  try{
    const r=await fetch('/.netlify/functions/fixtures');
    if(!r.ok) return;
    const j=await r.json();
    if(Array.isArray(j.matches)&&j.matches.length){matches=j.matches; $('#dataMode').textContent='DONNÉES LIVE'; $('#dataMode').className='pill success'; renderMatches();}
  }catch(_e){/* demo fallback */}
}

[...document.querySelectorAll('.seg')].forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.seg').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedFilter=b.dataset.filter;renderMatches()}));
$('#backBtn').onclick=renderMatches; $('#refreshBtn').onclick=()=>{renderMatches();tryLive()};
renderTabs(); renderMatches(); tryLive();
