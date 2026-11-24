export const FIELD = { width: 960, height: 540 };
export const GOAL = 40;
export const ROUND_SECONDS = 90;
export const WORKERS = 7;
export const NESTS = [{ x: 150, y: 327 }, { x: 810, y: 213 }];
export const FOOD = {
  sugar: { x: 338, y: 144, name: 'Sugar cubes', crumbs: 2, harvest: 2.3 },
  berry: { x: 483, y: 278, name: 'Strawberry', crumbs: 3, harvest: 3.0 },
  biscuit: { x: 622, y: 396, name: 'Biscuit', crumbs: 2, harvest: 2.3 },
};
export const ACTIONS = [...Object.keys(FOOD), 'raid', 'guard'];
export const ACTION_NAMES = { sugar: 'Sugar cubes', berry: 'Strawberry', biscuit: 'Biscuit', raid: 'Nest raid', guard: 'Guard duty' };
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

const contexts = ['quiet', 'under-raid'];
const formations = ['solo', 'escort'];
const initialStats = () => ({ runs: 0, deliveries: 0, stops: 0, guarded: 0, raided: 0, escorted: 0 });
const statKeys = Object.keys(initialStats());
const tableKeys = new Set();
for (const key of ACTIONS) {
  for (const ctx of contexts) tableKeys.add('route/' + ctx + '/' + key);
  for (const traffic of ['clear', 'contested']) {
    for (const formation of formations) tableKeys.add('team/' + key + '/' + traffic + '/' + formation);
  }
}

export const MODEL_KEYS = [...tableKeys];
export const STAT_KEYS = [...statKeys];

export class ColonyBrain {
  constructor(saved = {}, frozen = false) {
    this.table = {};
    this.stats = initialStats();
    this.frozen = frozen;
    if (!saved || saved.version !== 1) return;
    for (const [key, entry] of Object.entries(saved.table || {})) {
      if (!tableKeys.has(key) || !Array.isArray(entry)) continue;
      const [n, value] = entry;
      if (Number.isInteger(n) && n > 0 && n <= 1e7 && Number.isFinite(value) && Math.abs(value) <= 2) {
        this.table[key] = [n, value];
      }
    }
    for (const key of statKeys) {
      const value = saved.stats?.[key];
      if (Number.isSafeInteger(value) && value >= 0 && value <= 1e8) this.stats[key] = value;
    }
  }

  estimate(key, prior) {
    return this.table[key]?.[1] ?? prior;
  }

  update(key, reward, prior) {
    if (this.frozen) return;
    const [count, old] = this.table[key] || [0, prior];
    const rate = Math.max(0.16, 1 / (count + 2));
    this.table[key] = [Math.min(count + 1, 1e7), old + rate * (clamp(reward, -2, 2) - old)];
  }

  selectFormation(action, traffic, rng) {
    const key = 'team/' + action + '/' + traffic + '/';
    const initialSolo = 0.48;
    const initialEscort = traffic === 'contested' ? 0.52 : 0.16;
    if (rng() < 0.14) return rng() < 0.5 ? 'solo' : 'escort';
    return this.estimate(key + 'escort', initialEscort) > this.estimate(key + 'solo', initialSolo) ? 'escort' : 'solo';
  }

  record(party, reward) {
    if (this.frozen) return;
    const action = party.trail.key;
    this.update('route/' + party.context + '/' + action, reward, 0.35);
    if (action !== 'guard') this.update('team/' + action + '/' + party.traffic + '/' + party.formation, reward, 0.35);
    this.stats.runs++;
    if (party.carry > 0) this.stats.deliveries++;
    if (party.stopped) this.stats.stops++;
    this.stats.guarded += party.blocks;
    if (party.carry > 0 && action === 'raid') this.stats.raided += party.carry;
    if (party.formation === 'escort') this.stats.escorted++;
  }

  preference(context = 'quiet') {
    const entries = ACTIONS.map(key => ({ key, record: this.table['route/' + context + '/' + key] }))
      .filter(item => item.record).sort((a, b) => b.record[1] - a.record[1]);
    return entries[0]?.key || null;
  }

  save() {
    const table = {};
    for (const [key, [count, value]] of Object.entries(this.table)) table[key] = [count, Math.round(value * 10000) / 10000];
    return { version: 1, table, stats: { ...this.stats } };
  }
}

export function targetPoint(side, key, post) {
  if (FOOD[key]) return FOOD[key];
  if (key === 'raid') return NESTS[1 - side];
  return post || NESTS[side];
}

function boundPoint(point) {
  return { x: clamp(point.x, 12, FIELD.width - 12), y: clamp(point.y, 12, FIELD.height - 12) };
}

export function makeTrail(side, key, via = [], post = null) {
  if (!ACTIONS.includes(key)) return null;
  const start = NESTS[side], end = targetPoint(side, key, post);
  let points;
  if (via.length) {
    const stride = Math.max(1, Math.ceil(via.length / 36));
    const middle = via.filter((p, i) => i % stride === 0 && Number.isFinite(p.x) && Number.isFinite(p.y)).map(boundPoint);
    points = [start, ...middle, end];
  } else {
    const dx = end.x - start.x, dy = end.y - start.y;
    const bend = (side === 0 ? 1 : -1) * (key === 'berry' ? -1 : 1);
    points = [start, { x: start.x + dx * 0.36 - dy * 0.105 * bend, y: start.y + dy * 0.36 + dx * 0.105 * bend },
      { x: start.x + dx * 0.71 - dy * 0.065 * bend, y: start.y + dy * 0.71 + dx * 0.065 * bend }, end];
  }
  const clean = [points[0]], cumulative = [0];
  for (const p of points.slice(1)) {
    const length = distance(clean.at(-1), p);
    if (length < 1) continue;
    clean.push(p);
    cumulative.push(cumulative.at(-1) + length);
  }
  return { side, key, points: clean, cumulative, length: cumulative.at(-1), end, post: !!post };
}

export function along(trail, travelled) {
  if (!trail.length) return { ...trail.end, angle: 0 };
  const d = clamp(travelled, 0, trail.length);
  let i = 1;
  while (i < trail.cumulative.length - 1 && trail.cumulative[i] < d) i++;
  const a = trail.points[i - 1], b = trail.points[i];
  const t = (d - trail.cumulative[i - 1]) / (trail.cumulative[i] - trail.cumulative[i - 1]);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export class Arena {
  constructor({ moss = new ColonyBrain(), ember = new ColonyBrain(), rng = Math.random } = {}) {
    this.brains = [moss, ember];
    this.rng = rng;
    this.trails = [[makeTrail(0, 'sugar'), null], [makeTrail(1, 'biscuit'), makeTrail(1, 'berry')]];
    this.phase = 'ready';
    this.time = 0;
    this.scores = [0, 0];
    this.tension = [0, 0];
    this.parties = [];
    this.effects = [];
    this.patches = Object.fromEntries(Object.keys(FOOD).map(key => [key, { left: 7, refill: 0 }]));
    this.events = [];
    this.totals = [initialStats(), initialStats()];
    this.nextLaunch = [0.12, 0.24];
    this.rotation = [0, 0];
    this.nextPlan = 0;
    this.serial = 0;
    this.winner = null;
  }

  emit(kind, message) {
    this.events.push({ time: this.time, kind, message });
    if (this.events.length > 40) this.events.shift();
  }

  setTrail(slot, key, via = [], post = null) {
    if (![0, 1].includes(slot) || this.phase === 'over') return;
    this.trails[0][slot] = key ? makeTrail(0, key, via, post) : null;
  }

  start() {
    if (this.phase !== 'ready') return;
    this.phase = 'live';
    this.emit('field', 'Both colonies left their nests.');
  }

  pause() { if (this.phase === 'live') this.phase = 'paused'; }
  resume() { if (this.phase === 'paused') this.phase = 'live'; }

  context(side) { return this.tension[side] > 0 ? 'under-raid' : 'quiet'; }

  planRival() {
    const brain = this.brains[1], ctx = this.context(1);
    const priority = key => {
      const travel = distance(NESTS[1], targetPoint(1, key));
      let prior = 0.7 - travel / 1400 + (FOOD[key]?.crumbs || 0) * 0.06;
      if (key === 'raid') prior = this.scores[0] > 2 ? 0.37 : -0.35;
      if (key === 'guard') prior = ctx === 'under-raid' ? 0.70 : -0.34;
      const empty = this.patches[key]?.left === 0 ? 0.65 : 0;
      return brain.estimate('route/' + ctx + '/' + key, prior) + this.rng() * 0.13 - empty;
    };
    const ranked = ACTIONS.map(key => ({ key, value: priority(key) })).sort((a, b) => b.value - a.value);
    const food = ranked.filter(x => FOOD[x.key]);
    const first = this.rng() < 0.13 ? food[Math.floor(this.rng() * food.length)].key : food[0].key;
    const choices = ranked.filter(x => x.key !== first && (x.key !== 'raid' || this.scores[0] > 0));
    const second = this.rng() < 0.23 ? choices[Math.floor(this.rng() * choices.length)].key : choices[0].key;
    const was = this.trails[1].map(trail => trail?.key);
    if (this.time > 7 && !was.includes(second)) {
      const reports = { guard: 'Ember sent guards back to its nest.', raid: 'Ember opened a raiding trail.',
        sugar: 'Ember laid a new trail to the sugar cubes.', biscuit: 'Ember turned toward the biscuit.', berry: 'Ember switched a trail to the strawberry.' };
      this.emit('intel', reports[second]);
    }
    this.trails[1] = [first, second].map((key, index) => this.trails[1][index]?.key === key ? this.trails[1][index] : makeTrail(1, key));
  }

  deploy(side) {
    const mine = this.parties.filter(p => p.side === side);
    const free = WORKERS - mine.reduce((sum, p) => sum + p.cost, 0);
    const routes = this.trails[side].filter(Boolean);
    if (!free || !routes.length) return;
    const trail = routes[this.rotation[side]++ % routes.length];
    const crowded = this.parties.some(p => p.side !== side && !p.stopped && distance(p, trail.end) < 122);
    const traffic = crowded ? 'contested' : 'clear';
    const formation = trail.key === 'guard' || free < 2 ? 'solo' : this.brains[side].selectFormation(trail.key, traffic, this.rng);
    const cost = formation === 'escort' ? 2 : 1;
    const direction = along(trail, 0);
    this.parties.push({
      id: ++this.serial, side, trail, formation, cost, traffic, context: this.context(side),
      ...direction, phase: 'out', d: 0, born: this.time, carry: 0, stolen: 0, blocks: 0,
      stopped: false, wait: 0, cooldown: 0, done: false,
      lane: (this.rng() - 0.5) * 17, speed: (59 + this.rng() * 9) * (cost === 2 ? 0.93 : 1),
    });
  }

  sparkle(p, type) { this.effects.push({ x: p.x, y: p.y, side: p.side, type, born: this.time }); }

  turnBack(p) { p.phase = 'back'; p.angle += Math.PI; }

  reach(p) {
    const key = p.trail.key;
    if (key === 'guard') {
      p.phase = 'guarding';
      p.wait = 7.5;
      return;
    }
    p.phase = 'gather';
    p.wait = FOOD[key]?.harvest || 1.7;
    if (key === 'raid') this.tension[1 - p.side] = 22;
  }

  collect(p) {
    const key = p.trail.key, other = 1 - p.side;
    if (key === 'raid') {
      p.stolen = Math.min(4, this.scores[other]);
      this.scores[other] -= p.stolen;
      p.carry = p.stolen;
      this.tension[other] = 24;
      if (p.stolen) {
        this.sparkle(p, 'raid');
        this.emit('raid', (p.side === 0 ? 'Moss' : 'Ember') + ' raiders took ' + p.stolen + ' crumbs.');
      }
    } else {
      const patch = this.patches[key];
      if (patch.left > 0) {
        p.carry = FOOD[key].crumbs;
        if (--patch.left === 0) {
          patch.refill = this.time + 10;
          this.emit('field', FOOD[key].name + ' picked clean. Fresh crumbs in 10 seconds.');
        }
      }
    }
    this.turnBack(p);
  }

  stopParty(unit, intruder) {
    if (intruder.stolen) this.scores[unit.side] += intruder.stolen;
    intruder.carry = 0;
    intruder.stolen = 0;
    intruder.stopped = true;
    if (intruder.phase !== 'back') this.turnBack(intruder);
    unit.blocks++;
    unit.cooldown = 2.0;
    intruder.cooldown = 5;
    this.sparkle(intruder, 'block');
    this.emit('guard', (unit.side === 0 ? 'Moss' : 'Ember') + ' intercepted a rival party.');
  }

  encounters() {
    for (const unit of this.parties) {
      const sentry = unit.phase === 'guarding';
      const raider = unit.trail.key === 'raid' && unit.phase === 'out';
      if ((!sentry && !raider) || unit.stopped || unit.done || unit.cooldown > 0) continue;
      const radius = sentry ? 64 : 30;
      const target = this.parties.find(p => p.side !== unit.side && !p.done && !p.stopped && p.cooldown <= 0 &&
        p.phase !== 'guarding' && (sentry || p.carry > 0) && distance(p, unit) <= radius);
      if (!target) continue;
      if (target.formation === 'escort' && this.rng() < 0.76) {
        target.cooldown = 4;
        unit.cooldown = 2;
        this.sparkle(target, 'shield');
      } else {
        this.stopParty(unit, target);
      }
    }
  }

  finishRun(p) {
    const side = p.side;
    this.scores[side] += p.carry;
    const age = Math.max(this.time - p.born, 4);
    let reward = p.carry * 5.3 / age / p.cost + p.blocks * 0.48;
    if (!p.carry && !p.blocks) reward = p.stopped ? -0.9 : -0.32;
    this.brains[side].record(p, reward);
    const stats = this.totals[side];
    stats.runs++;
    if (p.carry) {
      if (!stats.deliveries) this.emit('delivery', (side === 0 ? 'Moss' : 'Ember') + ' brought its first ' + p.carry + ' crumbs home.');
      stats.deliveries++;
      this.sparkle(p, '+' + p.carry);
    }
    if (p.stopped) stats.stops++;
    stats.guarded += p.blocks;
    if (p.trail.key === 'raid') stats.raided += p.carry;
    if (p.formation === 'escort') stats.escorted++;
    p.done = true;
  }

  move(p, dt) {
    p.cooldown -= dt;
    if (p.phase === 'gather' || p.phase === 'guarding') {
      p.wait -= dt;
      if (p.wait <= 0) {
        if (p.phase === 'gather') this.collect(p);
        else this.turnBack(p);
      }
      return;
    }
    const returning = p.phase === 'back';
    const speed = p.speed * (p.stopped ? 1.32 : p.carry ? 0.88 : 1);
    p.d = clamp(p.d + (returning ? -1 : 1) * speed * dt, 0, p.trail.length);
    const at = along(p.trail, p.d);
    const spread = Math.min(1, p.d / 30, (p.trail.length - p.d) / 30);
    p.x = at.x - Math.sin(at.angle) * p.lane * spread;
    p.y = at.y + Math.cos(at.angle) * p.lane * spread;
    p.angle = at.angle + (returning ? Math.PI : 0);
    if (returning && p.d <= 0) this.finishRun(p);
    else if (!returning && p.d >= p.trail.length) this.reach(p);
  }

  step(dt) {
    if (this.phase !== 'live' || !Number.isFinite(dt) || dt <= 0) return;
    this.time = Math.min(ROUND_SECONDS, this.time + dt);
    for (const patch of Object.values(this.patches)) {
      if (!patch.left && this.time >= patch.refill) patch.left = 7;
    }
    for (const side of [0, 1]) this.tension[side] = Math.max(0, this.tension[side] - dt);
    if (this.time >= this.nextPlan) {
      this.planRival();
      this.nextPlan = this.time + 6.2;
    }
    for (const side of [0, 1]) {
      if (this.time >= this.nextLaunch[side]) {
        this.deploy(side);
        this.nextLaunch[side] = this.time + 0.9;
      }
    }
    for (const p of this.parties) this.move(p, dt);
    this.encounters();
    this.parties = this.parties.filter(p => !p.done);
    this.effects = this.effects.filter(e => this.time - e.born < 1.05);
    if (this.time >= ROUND_SECONDS || Math.max(...this.scores) >= GOAL) {
      this.phase = 'over';
      this.winner = this.scores[0] === this.scores[1] ? 'draw' : this.scores[0] > this.scores[1] ? 'moss' : 'ember';
    }
  }
}
