import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, ColonyBrain, makeTrail, along, distance, NESTS, FOOD, ACTIONS, ROUND_SECONDS, WORKERS } from '../src/engine.js';
import { encodeChallenge, decodeChallenge, loadNotebook, saveNotebook } from '../src/memory.js';

function random(seed) {
  let value = seed;
  return () => ((value = (1664525 * value + 1013904223) >>> 0) / 4294967296);
}
function advance(arena, seconds) {
  for (let i=0;i<Math.ceil(seconds*30);i++) arena.step(1/30);
}
function trip(formation, successful) {
  return { trail:{key:'sugar'}, context:'quiet', traffic:'contested', formation,
    carry:successful?2:0, stopped:!successful, blocks:0 };
}

test('colony changes its formation from actual feedback and keeps it after reload', () => {
  const brain=new ColonyBrain();
  const exploit=()=>0.86;
  for(let i=0;i<15;i++){brain.record(trip('solo',true),1.1);brain.record(trip('escort',false),-.8);}
  assert.equal(brain.selectFormation('sugar','contested',exploit),'solo');
  for(let i=0;i<30;i++){brain.record(trip('solo',false),-.9);brain.record(trip('escort',true),.75);}
  assert.equal(brain.selectFormation('sugar','contested',exploit),'escort');
  assert.equal(new ColonyBrain(brain.save()).selectFormation('sugar','contested',exploit),'escort');
  assert.equal(brain.stats.runs,90);
});

test('rival shifts its second trail to guard following repeated successful defense under pressure', () => {
  const brain=new ColonyBrain();
  for(let i=0;i<12;i++){
    brain.update('route/quiet/guard',-.6,.35);
    brain.update('route/under-raid/guard',1.45,.35);
  }
  const arena=new Arena({ember:brain,rng:()=>.6});
  arena.planRival();assert.ok(!arena.trails[1].some(t=>t.key==='guard'));
  arena.tension[1]=20;arena.planRival();assert.ok(arena.trails[1].some(t=>t.key==='guard'));
});

test('a drawn trail follows waypoints both ways and field parties finish their existing order', () => {
  const waypoint={x:210,y:230}, route=makeTrail(0,'sugar',[waypoint]);
  const middle=along(route,distance(NESTS[0],waypoint));
  assert.ok(distance(middle,waypoint)<1e-8);
  assert.ok(distance(along(route,route.length),FOOD.sugar)<1e-8);
  const g=new Arena({rng:random(4)});g.setTrail(0,'sugar',[waypoint]);g.start();advance(g,1.3);
  const p=g.parties.find(x=>x.side===0);g.setTrail(0,'raid');g.setTrail(1,'berry');g.setTrail(2,'guard');
  assert.equal(g.trails[0].length,2);assert.equal(p.trail.key,'sugar');assert.equal(g.trails[0][0].key,'raid');
  const before=g.time;g.pause();advance(g,2);assert.equal(g.time,before);g.resume();advance(g,1);assert.ok(g.time>before);
});

test('raids debit the opposing nest and an interception restores the stolen load once', () => {
  const g=new Arena({rng:random(6)});g.scores=[0,6];g.setTrail(0,'raid');g.deploy(0);
  const thief=g.parties[0];g.collect(thief);assert.deepEqual(g.scores,[0,2]);assert.equal(thief.carry,4);
  const defender={side:1,blocks:0,cooldown:0};
  g.stopParty(defender,thief);assert.deepEqual(g.scores,[0,6]);assert.equal(thief.stolen,0);
  g.finishRun(thief);assert.deepEqual(g.scores,[0,6]);assert.equal(g.brains[0].stats.stops,1);
});

test('depleted food can be contested and replenishes exactly once its cooldown ends', () => {
  const g=new Arena({rng:random(9)});g.patches.sugar.left=1;g.deploy(0);
  const p=g.parties[0];g.collect(p);assert.equal(p.carry,2);assert.equal(g.patches.sugar.left,0);
  g.deploy(0);const second=g.parties.at(-1);g.collect(second);assert.equal(second.carry,0);
  g.start();g.time=9.95;g.step(.1);assert.equal(g.patches.sugar.left,7);
});

test('seeded matches finish, conserve workers, and keep both colonies learning between rounds', () => {
  const moss=new ColonyBrain(), ember=new ColonyBrain();
  for(let i=0;i<6;i++){
    const g=new Arena({moss,ember,rng:random(71+i)});g.setTrail(1,ACTIONS[i%5]);g.start();
    while(g.phase==='live'){
      g.step(.1);
      for(const side of [0,1]){
        const deployed=g.parties.filter(p=>p.side===side).reduce((sum,p)=>sum+p.cost,0);
        assert.ok(deployed<=WORKERS);assert.ok(g.scores[side]>=0);
      }
    }
    assert.ok(g.time<=ROUND_SECONDS);assert.ok(['draw','moss','ember'].includes(g.winner));
    for(const b of g.brains)assert.ok(b.stats.runs>0);
  }
  assert.ok(moss.stats.runs>60);assert.ok(ember.stats.runs>60);
  assert.ok(Object.keys(ember.table).some(key=>key.startsWith('route/under-raid/')));
});

test('timeout resolves a tie and frozen challenges keep their policy across matches', () => {
  const trained=new ColonyBrain();trained.record(trip('escort',true),.75);
  const frozen=decodeChallenge(encodeChallenge(trained));
  assert.ok(frozen?.frozen);assert.deepEqual(frozen.stats,trained.stats);
  const policy=JSON.stringify(frozen.save());const g=new Arena({ember:frozen,rng:random(70)});g.start();advance(g,55);
  assert.equal(JSON.stringify(frozen.save()),policy);
  const tied=new Arena();tied.scores=[5,5];tied.start();tied.time=89.99;tied.step(.02);
  assert.equal(tied.winner,'draw');
  for(const broken of ['#', '====', 'A'.repeat(6500), btoa('[1,{},[]]')])assert.equal(decodeChallenge(broken),null);
});

test('local notebook survives reload, unavailable storage, and unrelated data', () => {
  const memory=new Map(), storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  const b=loadNotebook(storage);b.moss.record(trip('solo',true),.5);b.record[0]=2;
  assert.ok(saveNotebook(storage,b));const loaded=loadNotebook(storage);assert.deepEqual(loaded.record,[2,0,0]);assert.equal(loaded.moss.stats.runs,1);
  assert.equal(saveNotebook(null,b),false);assert.equal(loadNotebook({getItem:()=>'{'}).moss.stats.runs,0);
});
