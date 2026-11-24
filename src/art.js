import { FIELD, FOOD, NESTS, along, clamp, distance } from './engine.js';

const green = '#b1e884', red = '#ff9780';
const terrain = new Image(), atlas = new Image();
terrain.src = new URL('../assets/picnic-clearing.webp', import.meta.url);
atlas.src = new URL('../assets/field-sprites.png', import.meta.url);
const spriteIndex = { sugar: 2, berry: 3, biscuit: 4 };
const demoTrails = [0.15, 0.33, 0.5, 0.72, 0.9];

function sprite(ctx, index, x, y, size) {
  if (!atlas.complete || !atlas.naturalWidth) return;
  ctx.drawImage(atlas, index * 80, 0, 80, 80, Math.round(x - size / 2), Math.round(y - size * 0.57), size, size);
}

function ant(ctx, x, y, angle, side, scale, beat, carry = 0, guard = false) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#34291d66';
  ctx.fillRect(-6, 1, 13, 4);
  const dark = side ? '#522d26' : '#293b28', shell = side ? '#b65036' : '#557743', light = side ? '#ff9d70' : '#a9d579';
  const phase = Math.sin(beat) > 0 ? 1 : -1;
  ctx.strokeStyle = dark; ctx.lineWidth = 1.3;
  for (let i = 0; i < 3; i++) {
    const px = -3 + i * 3, step = (i % 2 ? -1 : 1) * phase;
    for (const sign of [-1, 1]) {
      ctx.beginPath();ctx.moveTo(px, sign);ctx.lineTo(px + step, sign * 3);
      ctx.lineTo(px + (i - 1) * 2 + step, sign * 5);ctx.stroke();
    }
  }
  ctx.beginPath();ctx.moveTo(5, -1);ctx.lineTo(7, -3);ctx.lineTo(9, -3);
  ctx.moveTo(5, 1);ctx.lineTo(7, 3);ctx.lineTo(9, 3);ctx.stroke();
  const body = (px, w, h) => {
    ctx.fillStyle = dark;ctx.fillRect(px, -h / 2, w, h);
    ctx.fillStyle = shell;ctx.fillRect(px + 1, -h / 2, w - 2, h - 1);
    ctx.fillStyle = light;ctx.fillRect(px + 1, -h / 2, Math.max(1, w - 3), 1);
  };
  body(-7, 6, 5);body(-1, 4, 4);body(3, 4, 4);
  if (carry) {ctx.fillStyle='#765538';ctx.fillRect(6,-3,5,5);ctx.fillStyle='#ffe09d';ctx.fillRect(6,-3,4,3);}
  if (guard) {ctx.fillStyle='#fff6c7';ctx.fillRect(-5,-2,2,1);}
  ctx.restore();
}

export class FieldView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = { w: 1, h: 1 };
    this.draft = null;
    this.hover = null;
    this.pulse = null;
    this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(canvas);
    this.measure();
  }

  measure() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = { w: rect.width || 1, h: rect.height || 1 };
    this.canvas.width = Math.round(this.size.w * dpr);
    this.canvas.height = Math.round(this.size.h * dpr);
  }

  screen(p) { return { x: p.x * this.size.w / FIELD.width, y: p.y * this.size.h / FIELD.height }; }

  world(event) {
    const m = this.canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - m.left) * FIELD.width / m.width, 0, FIELD.width),
      y: clamp((event.clientY - m.top) * FIELD.height / m.height, 0, FIELD.height) };
  }

  target(p) {
    const screen = this.screen(p);
    const candidates = [...Object.entries(FOOD), ['guard', NESTS[0]], ['raid', NESTS[1]]]
      .map(([key, point]) => ({ key, point, d: distance(screen, this.screen(point)) }))
      .sort((a,b) => a.d - b.d);
    const hit = candidates[0], reach = (hit.key === 'raid' || hit.key === 'guard' ? 46 : 35) * this.scale();
    return hit.d <= Math.max(24, reach) ? { key: hit.key, at: hit.point } : { key: 'guard', at: p, post: true };
  }

  scale() { return clamp(Math.min(this.size.w / 870, this.size.h / 445), 0.63, 1.65); }

  route(trail, side, index, t, selected) {
    if (!trail) return;
    const ctx = this.ctx, scale = this.scale(), pts = trail.points.map(p => this.screen(p));
    if (pts.length < 2) return;
    function trace() {
      ctx.beginPath();ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    ctx.lineWidth=(selected ? 5 : 3.4)*scale;
    ctx.strokeStyle=side?'#673b2a66':'#314c304d';trace();
    ctx.lineWidth=(side?2.1:selected?2.8:2.2)*scale;
    ctx.strokeStyle=side?'#f9a28ae6':index===0?'#c2f69b':'#e9eb9d';
    ctx.setLineDash([2*scale,7*scale]);ctx.lineDashOffset=-t*scale*2;
    trace();ctx.restore();
    if (trail.key === 'guard' && trail.post) {
      const g=this.screen(trail.end);
      ctx.strokeStyle=side?red:green;ctx.lineWidth=2*scale;
      ctx.beginPath();ctx.arc(g.x,g.y,10*scale,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle=side?red:green;ctx.fillRect(g.x-2*scale,g.y-2*scale,4*scale,4*scale);
    }
  }

  label(text, x, y, color, scale, isNest = false) {
    const ctx=this.ctx;
    const size = Math.max(9, Math.round((isNest ? 10.5 : 10)*scale));
    ctx.save();ctx.font='600 '+size+'px "Space Mono", monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    const w=Math.ceil(ctx.measureText(text).width)+size, h=size+5;
    ctx.fillStyle=isNest?'#25271def':'#3e3524ce';
    ctx.fillRect(Math.round(x-w/2),Math.round(y-h/2),w,h);
    if(isNest){ctx.fillStyle=color;ctx.fillRect(Math.round(x-w/2),Math.round(y-h/2),2,h);}
    ctx.fillStyle=color;ctx.fillText(text,x,y+0.5);ctx.restore();
  }

  draw(game, elapsed, selected) {
    const ctx=this.ctx, {w,h}=this.size, scale=this.scale(), ratio=this.canvas.width/w;
    if (!Number.isFinite(ratio) || !ratio) return;
    ctx.setTransform(ratio,0,0,this.canvas.height/h,0,0);
    ctx.imageSmoothingEnabled=false;
    ctx.fillStyle='#ab8046';ctx.fillRect(0,0,w,h);
    if(terrain.complete && terrain.naturalWidth)ctx.drawImage(terrain,0,0,w,h);
    const t=this.reduce ? 0 : elapsed;
    for (const side of [1,0]) for (let i=0;i<2;i++) this.route(game.trails[side][i],side,i,t,side===0 && i===selected);
    if(this.draft?.length>1) {
      ctx.save();ctx.strokeStyle='#f4ffb7';ctx.lineWidth=Math.max(3,4*scale);ctx.lineJoin='round';
      ctx.setLineDash([4,5]);ctx.beginPath();
      this.draft.forEach((p,i)=>{const a=this.screen(p);if(i)ctx.lineTo(a.x,a.y);else ctx.moveTo(a.x,a.y);});ctx.stroke();ctx.restore();
    }
    for(const [key,p] of Object.entries(FOOD)){
      const at=this.screen(p), hovered=this.hover?.key===key;
      if(hovered)this.ring(at,26*scale,'#fff2b7',2);
      const empty=game.patches?.[key]?.left===0;
      ctx.globalAlpha=empty?0.47:1;
      sprite(ctx,spriteIndex[key],at.x,at.y,scale*(key==='berry'?86:83));
      ctx.globalAlpha=1;
      this.label(empty?'REFILLING':p.name.toUpperCase(),at.x,at.y+26*scale,'#fff3d1',scale);
    }
    for (const side of [0,1]){
      const at=this.screen(NESTS[side]);
      if(this.hover?.key===(side?'raid':'guard')&&!this.hover.post)this.ring(at,40*scale,side?red:green,2);
      sprite(ctx,side,at.x,at.y-5*scale,scale*129);
      this.label(side?'EMBER NEST':'MOSS NEST',at.x,at.y+38*scale,side?'#ffbc9e':'#cdf09e',scale,true);
    }
    if(game.phase==='ready') {
      for (const side of [0,1]) {
        const trail=game.trails[side].find(Boolean);
        const nest=this.screen(NESTS[side]);
        for(let i=0;i<7;i++){
          let x,y,a;
          if(i<demoTrails.length && trail?.length>15){
            const point=along(trail,trail.length*clamp(demoTrails[i]+Math.sin(t*.44+i)*.024,0,1));
            const n=this.screen(point);
            x=n.x+Math.sin(i*2)*4*scale;y=n.y+Math.cos(i*1.7)*7*scale;a=this.screenAngle(point.angle);
          } else {
            a=i*2.2+side+t*.16;
            x=nest.x+Math.cos(a)*scale*(34+i);y=nest.y+Math.sin(a)*scale*23;
            a+=Math.PI/2;
          }
          ant(ctx,x,y,a,side,scale*.95,t*7+i);
        }
      }
    }
    for(const p of game.parties){
      const at=this.screen(p), angle=this.screenAngle(p.angle);
      const onPost=p.phase==='guarding', idle=onPost||p.phase==='gather';
      const theta=p.id*2.4;
      const offset=idle?10*scale:0;
      const x=at.x+Math.cos(theta)*offset,y=at.y+Math.sin(theta)*offset;
      if(onPost){ctx.save();ctx.setLineDash([3,7]);this.ring(at,36*scale,p.side?'#ed8a6880':'#c6eea0ae',1.4);ctx.restore();}
      if(p.formation==='escort'){
        ant(ctx,x-Math.cos(angle-.6)*12*scale,y-Math.sin(angle-.6)*12*scale,angle,p.side,scale*.93,t*11+2+p.id,0,true);
      }
      ant(ctx,x,y,angle,p.side,scale*(p.trail.key==='raid'?1.09:1),idle?p.id:t*12+p.id,p.carry,onPost);
    }
    for(const e of game.effects){
      const p=this.screen(e), age=game.time-e.born;
      ctx.save();ctx.globalAlpha=Math.min(1,(1.05-age)*2);ctx.textAlign='center';
      ctx.font='bold '+Math.round(15*scale)+'px "Space Mono", monospace';ctx.lineWidth=3;ctx.strokeStyle='#382e24';
      ctx.fillStyle=e.side?red:green;
      const txt=e.type==='block'?'×':e.type==='shield'?'◆':e.type==='raid'?'!':e.type;
      ctx.strokeText(txt,p.x,p.y-(18+age*18)*scale);ctx.fillText(txt,p.x,p.y-(18+age*18)*scale);ctx.restore();
    }
    if(this.pulse) {
      const age=performance.now()/1000-this.pulse.time;
      if(age>.75)this.pulse=null;
      else{ctx.save();ctx.globalAlpha=1-age/.75;this.ring(this.screen(this.pulse.point),(12+age*34)*scale,'#f5f0b2',2);ctx.restore();}
    }
  }

  screenAngle(angle) { return Math.atan2(Math.sin(angle)*this.size.h/FIELD.height,Math.cos(angle)*this.size.w/FIELD.width); }

  ring(p,r,col,width) {
    this.ctx.beginPath();this.ctx.arc(p.x,p.y,r,0,Math.PI*2);
    this.ctx.strokeStyle=col;this.ctx.lineWidth=width;this.ctx.stroke();
  }
}

const glyphs = {
  field: [[[3,8],[3,4],[7,4]],[[17,4],[21,4],[21,8]],[[21,16],[21,20],[17,20]],[[7,20],[3,20],[3,16]],[[8,12],[16,12]],[[12,8],[12,16]]],
  lab: [[[4,16],[8,16],[11,8],[17,8]],[[9,16],[15,16],[18,12]]],
  book: [[[2,5],[6,4],[10,5],[12,7],[14,5],[19,4],[22,5],[22,18],[18,17],[15,18],[12,20],[9,18],[6,17],[2,18],[2,5]],[[12,7],[12,20]]],
  muted: [[[3,9],[7,9],[12,5],[12,19],[7,15],[3,15],[3,9]],[[16,9],[22,15]],[[22,9],[16,15]]],
  sound: [[[3,9],[7,9],[12,5],[12,19],[7,15],[3,15],[3,9]],[[16,8],[18,10],[18,14],[16,16]],[[19,5],[22,9],[22,15],[19,19]]],
  cross: [[[6,6],[18,18]],[[18,6],[6,18]]],
  play: [[[7,4],[20,12],[7,20],[7,4]]],
  pause: [[[8,5],[8,19]],[[16,5],[16,19]]],
  expand: [[[3,9],[3,3],[9,3]],[[15,3],[21,3],[21,9]],[[21,15],[21,21],[15,21]],[[9,21],[3,21],[3,15]]],
  clock: [[[12,6],[12,12],[16,14]]],
  flag: [[[5,21],[5,3],[18,3],[16,7],[19,10],[5,10]]],
  stack: [[[3,8],[12,3],[21,8],[12,13],[3,8]],[[3,12],[12,17],[21,12]],[[3,16],[12,21],[21,16]]],
  trail: [[[3,17],[8,17],[13,7],[20,7]]],
  pin: [[[8,10],[12,16],[16,10]]],
  chevron: [[[7,10],[12,15],[17,10]]],
  check: [[[4,12],[9,17],[20,6]]],
  plus: [[[12,5],[12,19]],[[5,12],[19,12]]],
  trash: [[[4,6],[20,6]],[[8,6],[8,3],[16,3],[16,6]],[[6,7],[7,20],[17,20],[18,7]],[[10,10],[10,16]],[[14,10],[14,16]]],
  list: [[[8,6],[21,6]],[[8,12],[21,12]],[[8,18],[21,18]]],
  shield: [[[12,2],[20,5],[19,13],[16,17],[12,20],[8,17],[5,13],[4,5],[12,2]]],
  share: [[[8,12],[17,7]],[[8,12],[17,17]]],
  note: [[[6,3],[16,3],[20,7],[20,21],[6,21],[6,3]],[[15,3],[15,8],[20,8]],[[9,12],[16,12]],[[9,16],[16,16]]],
  pointer: [[[5,3],[18,12],[12,13],[10,19],[5,3]]],
  antenna: [[[5,19],[12,5],[19,19]],[[8,14],[16,14]],[[9,18],[15,18]]],
  crumb: [[[3,9],[10,5],[16,9],[9,13],[3,9],[3,16],[9,20],[16,16],[16,9]],[[9,13],[9,20]],[[14,4],[17,2],[21,5],[18,8]]],
  rewind: [[[4,7],[4,13],[10,13]],[[5,12],[8,7],[14,5],[19,8],[20,14],[17,18],[11,19]]],
};
const circles = { lab:[[4,16,2],[11,8,2],[18,8,2],[18,13,1]], clock:[[12,12,9]], trail:[[3,17,2],[20,7,2]], share:[[6,12,2.5],[18,6,2.5],[18,18,2.5]], list:[[3,6,.8],[3,12,.8],[3,18,.8]], pin:[[12,8,5]] };
export function drawIcons(root=document) {
  for (const el of root.querySelectorAll('canvas[data-icon]')) {
    const name=el.dataset.icon;
    el.width=48;el.height=48;const c=el.getContext('2d');c.scale(2,2);
    c.lineWidth=name==='pause'?3:1.8;c.lineCap='round';c.lineJoin='round';
    c.strokeStyle=c.fillStyle=getComputedStyle(el).color;
    for(const path of glyphs[name]||[]){
      c.beginPath();path.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();
      if(name==='play')c.fill();
    }
    for(const [x,y,r] of circles[name]||[]){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke();}
  }
}
