import { Game } from './src/sim/game.js';
import { AIController } from './src/sim/ai.js';
import { applyBalance, statsUnit } from './src/ui/balance.js';
applyBalance();
const DT=1/30;
function run(label, g){
  const game=new Game(4242,{races:['orcs','humans']});
  const ai0=new AIController(0,'normal',111,g), ai1=new AIController(1,'normal',222,g);
  const buys=[{},{}];
  const orig=game.issueCommand.bind(game);
  game.issueCommand=(c)=>{const r=orig(c); if(r.ok&&c.type==='buy'){buys[c.team][c.unitId]=(buys[c.team][c.unitId]||0)+1;} return r;};
  for(let s=0;s<Math.round(1260/DT)&&game.winner===null;s++){ai0.update(game,DT);ai1.update(game,DT);game.update(DT);}
  console.log(`\n--- ${label} (tiers ${game.tier}) ---`);
  for(const t of [0,1]){const race=game.races[t];
    const rows=Object.entries(buys[t]).map(([id,n])=>{const s=statsUnit(race,id)||{};return{n,name:s.name||id,tier:s.tier};}).sort((a,b)=>b.n-a.n);
    console.log(`  ${race}:`, rows.slice(0,6).map(r=>`${r.n}× ${r.name}(t${r.tier})`).join('  '));
  }
}
run('DEFAULT brain', null);
run('evolved-style (front85, patience3)', { tFront:0.85,tRanged:0.07,tSpecial:0.05,tSupport:0.03,counterChance:0.2,aggression:0.5,tier2Wave:3,tier3Wave:8,savePatience:3,farmBuffer:6,maxGens:8,midTowers:2 });
