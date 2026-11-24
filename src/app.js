import { Arena, FOOD, GOAL, ROUND_SECONDS, NESTS, ACTIONS, ACTION_NAMES, distance } from './engine.js';
import { FieldView, drawIcons } from './art.js';
import { loadNotebook, saveNotebook, encodeChallenge, decodeChallenge } from './memory.js';

const $ = id => document.getElementById(id);
const setText = (id, value) => { const e=$(id), s=String(value); if(e.textContent!==s)e.textContent=s; };
const icon = name => '<canvas data-icon="'+name+'" aria-hidden="true"></canvas>';
const two = n => String(n).padStart(2,'0');
const clock = sec => two(Math.floor(sec/60))+':'+two(Math.floor(sec%60));
let storage;
try { storage=window.localStorage; } catch {}
const book = loadNotebook(storage);
const incoming = new URLSearchParams(location.hash.slice(1)).get('colony');
const guest = decodeChallenge(incoming);
let game = new Arena({ moss:book.moss, ember:guest || book.ember });
let round = 1 + book.record.reduce((s,n)=>s+n,0);
let slot = 0, labSide = 0, resumeAfterDialog = false, resultRecorded = false;
let lastUI = -1, lastSaved = -10, lastRunCount = -1, hintUntil = 0, audioContext;
let memoryAvailable = saveNotebook(storage,book);
let previousPhase = '';
const field = new FieldView($('field'));
const dialog = $('dialog');
game.emit('field',incoming && !guest ? 'Challenge link unreadable. The local Ember colony is ready.' :
  guest ? 'A visiting colony has taken over the Ember nest.' : 'Moss scouts marked the sugar cubes.');

function persist() { memoryAvailable=saveNotebook(storage,book); }
function announce(message) { setText('announce',message); }
function hint(message) { setText('field-hint',message);hintUntil=performance.now()+3700;announce(message); }
function orderName(trail) { return trail?.key==='guard' ? (trail.post?'Guard post':'Nest guard') : ACTION_NAMES[trail?.key] || 'Unassigned'; }
function playTone(frequency=440, length=0.075, delay=0) {
  if(!book.sound) return;
  try {
    const AudioEngine=window.AudioContext || window.webkitAudioContext;
    if(!AudioEngine) return;
    audioContext ||= new AudioEngine();
    if(audioContext.state==='suspended')void audioContext.resume().catch(()=>{});
    const t=audioContext.currentTime+delay, osc=audioContext.createOscillator(), gain=audioContext.createGain();
    osc.type='triangle';osc.frequency.value=frequency;gain.gain.setValueAtTime(.0001,t);
    gain.gain.exponentialRampToValueAtTime(.09,t+.008);gain.gain.exponentialRampToValueAtTime(.0001,t+length);
    osc.connect(gain).connect(audioContext.destination);osc.start(t);osc.stop(t+length+.01);
  } catch {}
}

function syncSound() {
  $('sound').setAttribute('aria-pressed',String(book.sound));$('sound').setAttribute('aria-label','Turn sound '+(book.sound?'off':'on'));
  $('sound').title=book.sound?'Mute sound':'Enable sound';
  $('sound').firstElementChild.dataset.icon=book.sound?'sound':'muted';drawIcons($('sound'));
}

function selectSlot(i) {
  slot=i;
  for(let j=0;j<2;j++){
    const el=$('slot-'+j);
    el.classList.toggle('selected',j===i);el.setAttribute('aria-pressed',String(j===i));
    $('quick-'+(j+1)).classList.toggle('active',j===i);
  }
  $('clear').disabled=!game.trails[0][slot] || game.phase==='over';
}

function refreshTrails() {
  setText('capacity',game.trails[0].filter(Boolean).length+' / 2 active');
  for(let i=0;i<2;i++){
    const trail=game.trails[0][i], btn=$('slot-'+i);
    const role=trail ? (FOOD[trail.key]?'Forage':trail.key==='raid'?'Raid':'Guard') : 'Open trail';
    setText('slot-role-'+i,role);
    setText('slot-name-'+i,orderName(trail));btn.classList.toggle('vacant',!trail);
    btn.setAttribute('aria-label','Trail '+(i+1)+', '+orderName(trail));
  }
  $('destination').disabled=game.phase==='over';
  selectSlot(slot);
}

function giveOrder(key, via=[], post=null) {
  if(game.phase==='over')return;
  game.setTrail(slot,key,via,post);
  const trail=game.trails[0][slot], name=orderName(trail);
  if(trail)field.pulse={point:trail.end,time:performance.now()/1000};
  refreshTrails();
  const message=trail?'Trail '+(slot+1)+' set to '+name+'.':'Trail '+(slot+1)+' cleared.';
  hint(message);game.emit('order',message);setText('log-latest',message);playTone(trail?510:290);
}

function action() {
  if(game.phase==='over'){ newRound();return; }
  if(game.phase==='ready'){game.start();playTone(340);playTone(540,.09,.075);announce('Round started.');}
  else if(game.phase==='live'){game.pause();playTone(290);announce('Round paused.');}
  else if(game.phase==='paused'){game.resume();playTone(490);announce('Round resumed.');}
  refreshHUD();
}

function newRound() {
  const routes=game.trails[0].slice();
  if(dialog.open){resumeAfterDialog=false;dialog.close();}
  game=new Arena({moss:book.moss,ember:guest||book.ember});
  game.trails[0]=routes;
  round=1+book.record.reduce((s,n)=>s+n,0);
  resultRecorded=false;lastSaved=-10;previousPhase='';field.pulse=null;field.hover=null;hintUntil=0;
  game.emit('field','Both colonies are ready for round '+round+'.');
  refreshTrails();refreshHUD();announce('Round '+round+' ready.');$('round-action').focus({preventScroll:true});
}

function intel() {
  const brain=book.moss, stats=brain.stats;
  if(!stats.runs) {
    setText('intel-title','Awaiting first return');
    setText('intel-body','Each trip teaches your colony when to travel solo or send an escort.');return;
  }
  const preferred=brain.preference();
  setText('intel-title',preferred?'Moss favors '+({sugar:'sugar cubes',biscuit:'the biscuit',berry:'the strawberry',guard:'guard duty',raid:'nest raids'}[preferred]):'Learning under pressure');
  setText('intel-body',stats.deliveries+' of '+stats.runs+' trips brought crumbs home. '+stats.escorted+' completed with an escort.');
}

function refreshHUD() {
  setText('round-num',two(round));
  setText('clock',clock(Math.ceil(Math.max(0,ROUND_SECONDS-game.time))));
  document.querySelector('.timer-block').classList.toggle('urgent',ROUND_SECONDS-game.time<=15 && game.phase==='live');
  for(const [i,name] of ['moss','ember'].entries()){
    setText(name+'-score',game.scores[i]);$(name+'-meter').style.width=Math.min(100,game.scores[i]/GOAL*100)+'%';
  }
  const phase=game.phase;
  if(phase!==previousPhase){
    previousPhase=phase;
    const names={ready:'Planning',live:'In play',paused:'Paused',over:'Round over'};
    const buttons={ready:'Start round',live:'Pause round',paused:'Resume round',over:'Next round'};
    setText('phase-name',names[phase]);$('phase-tag').classList.toggle('live',phase==='live');
    setText('action-label',buttons[phase]);setText('quick-action',{ready:'Start',live:'Pause',paused:'Resume',over:'Next'}[phase]);
    $('action-icon').dataset.icon=phase==='live'?'pause':phase==='over'?'rewind':'play';
    $('map-pause').hidden=phase!=='paused' || dialog.open;
    drawIcons($('round-action'));refreshTrails();
  }
  if(performance.now()>hintUntil)setText('field-hint',phase==='over'?'Round complete. Your colony remembers its trips.':'Tap a target, or draw a trail from your nest.');
  const event=game.events.at(-1);if(event)setText('log-latest',event.message);
  const count=book.moss.stats.runs+book.ember.stats.runs;
  if(count!==lastRunCount){intel();if(game.time-lastSaved>2 || lastRunCount<0){persist();lastSaved=game.time;lastRunCount=count;}}
}

function show(markup, kicker) {
  if(!dialog.open){
    resumeAfterDialog=game.phase==='live';
    if(resumeAfterDialog)game.pause();
  }
  setText('dialog-kicker',kicker);$('dialog-content').innerHTML=markup;
  if(!dialog.open)dialog.showModal();
  dialog.scrollTop=0;
  $('map-pause').hidden=true;
  drawIcons(dialog);
}

function guide() {
  show('<h2 id="dialog-title">Field guide</h2><p class="dialog-lead">Bring home 40 crumbs, or hold the lead when the 90-second clock expires. Equal scores at the buzzer draw.</p>'+
    '<div class="dialog-grid"><div class="guide-row"><span class="guide-icon">'+icon('trail')+'</span><p><strong>Draw two scent trails</strong>Select a trail, then tap a target or draw a path from Moss nest. Ants already out finish their trip.</p></div>'+
    '<div class="guide-row"><i class="tile berry"></i><p><strong>Haul picnic food</strong>Sugar and biscuit runs bring 2 crumbs. Strawberries bring 3. A patch picked clean refills in 10 seconds.</p></div>'+
    '<div class="guide-row"><span class="guide-icon">'+icon('shield')+'</span><p><strong>Guard or raid</strong>Tap open ground or your nest to post a guard. Tap the Ember nest to steal up to 4 crumbs. Escorts can slip past guards.</p></div>'+
    '<div class="guide-row"><span class="guide-icon">'+icon('lab')+'</span><p><strong>Train your colony</strong>Delivered crumbs, interceptions and travel time teach both colonies which orders and formations pay off. Open Colony lab to see the results.</p></div></div>'+
    '<p class="dialog-note dialog-bottom"><kbd>1</kbd> <kbd>2</kbd> Select trail &nbsp; <kbd>Space</kbd> Start or pause &nbsp; <kbd>H</kbd> Field guide</p>','Field manual');
}

function lab() {
  const brain=game.brains[labSide], st=brain.stats;
  const rows=ACTIONS.map(key=>{
    const n=(brain.table['route/quiet/'+key]?.[0]||0)+(brain.table['route/under-raid/'+key]?.[0]||0);
    let best='—';
    if(n && key==='guard')best='Patrol';
    else if(n){
      const teams=['solo','escort'].map(name=>{
        const vals=['clear','contested'].map(traffic=>brain.table['team/'+key+'/'+traffic+'/'+name]).filter(Boolean);
        const trips=vals.reduce((s,x)=>s+x[0],0);
        return {name,value:trips?vals.reduce((s,x)=>s+x[0]*x[1],0)/trips:-Infinity};
      }).sort((a,b)=>b.value-a.value);
      if(Number.isFinite(teams[0].value))best=teams[0].name==='solo'?'Solo':'Escort';
    }
    return '<tr><td>'+ACTION_NAMES[key]+'</td><td>'+n+'</td><td>'+best+'</td></tr>';
  }).join('');
  const record=book.record;
  show('<h2 id="dialog-title">Colony lab</h2><p class="dialog-lead">Inspect the habits your ants have learned from completed trips.</p>'+
    '<div class="segmented" role="group" aria-label="Inspect colony"><button id="lab-moss" class="'+(!labSide?'active':'')+'" aria-pressed="'+(!labSide)+'">Moss · You</button><button id="lab-ember" class="rival '+(labSide?'active':'')+'" aria-pressed="'+!!labSide+'">Ember · '+(guest?'Guest':'AI')+'</button></div>'+
    '<div class="stats"><div><b>'+st.runs+'</b><span>Trips logged</span></div><div><b>'+(st.runs?Math.round(st.deliveries/st.runs*100):0)+'%</b><span>Delivered</span></div><div><b>'+st.guarded+'</b><span>Interceptions</span></div></div>'+
    '<table class="lab-table"><thead><tr><th>Order</th><th>Trips</th><th>Best formation</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<p class="dialog-note dialog-bottom">'+(brain.frozen?'This visiting colony uses the policy its trainer shared.':memoryAvailable?'Learning is saved on this device.':'Learning is available for this visit.')+' Match record: '+record[0]+' wins, '+record[1]+' losses, '+record[2]+' draws.</p>'+
    '<div class="dialog-actions"><button class="secondary" id="share-colony">'+icon('share')+'Copy colony challenge</button></div>'+
    '<p class="dialog-note" style="margin-top:7px">Challenge a friend to play against a snapshot of your Moss colony.</p><div class="share-result" id="share-result" role="status"></div>','Colony memory');
  $('lab-moss').onclick=()=>{labSide=0;lab();$('lab-moss').focus();};
  $('lab-ember').onclick=()=>{labSide=1;lab();$('lab-ember').focus();};
  $('share-colony').onclick=async()=>{
    const url=new URL(location.href);url.hash='colony='+encodeChallenge(book.moss);
    try {
      if(!navigator.clipboard?.writeText)throw new Error('clipboard');
      await navigator.clipboard.writeText(url.href);setText('share-result','Challenge link copied.');
    } catch {
      const input=document.createElement('input');input.readOnly=true;input.value=url.href;input.setAttribute('aria-label','Colony challenge link');
      const result=$('share-result');result.replaceChildren('Copy this challenge link: ',input);input.focus();input.select();
    }
  };
}

function fieldLog() {
  const entries=game.events.map(e=>'<li><time>'+clock(Math.floor(e.time))+'</time><span>'+e.message+'</span></li>').reverse().join('');
  show('<h2 id="dialog-title">Field log</h2><p class="dialog-lead">Orders and encounters in round '+two(round)+'.</p><ul class="log-list">'+entries+'</ul>','Battlefield');
}

function report() {
  const winner=game.winner, totals=game.totals[0];
  const title=winner==='moss'?'Moss colony wins!':winner==='ember'?'Ember colony wins':'The round is drawn';
  const rival=game.brains[1], pressure=rival.preference('under-raid'), quiet=rival.preference();
  const insight=pressure?'Under raid pressure, Ember’s highest-rated order is '+ACTION_NAMES[pressure].toLowerCase()+'.':
    quiet?'Ember’s highest-rated order in quiet conditions is '+ACTION_NAMES[quiet].toLowerCase()+'.':'';
  const reason=game.time>=ROUND_SECONDS?'Time ran out on the picnic grounds.':'The winning colony reached the crumb goal.';
  show('<h2 id="dialog-title">'+title+'</h2><p class="dialog-lead">'+reason+'</p>'+
    '<div class="result-score"><div class="moss"><i class="tile ant-moss"></i><b>'+game.scores[0]+'</b><span>Moss colony</span></div><span>vs</span><div class="ember"><i class="tile ant-ember"></i><b>'+game.scores[1]+'</b><span>Ember colony</span></div></div>'+
    '<p class="lab-details">Moss completed '+totals.runs+' trips, brought home crumbs on '+totals.deliveries+' and intercepted '+totals.guarded+' rival '+(totals.guarded===1?'party':'parties')+'. '+insight+'</p>'+
    '<div class="dialog-actions"><button class="primary" id="new-round">'+icon('play')+'Next round</button><button class="secondary" id="result-lab">'+icon('lab')+'Inspect colony</button></div>',
    'Round '+two(round)+' complete');
  $('new-round').onclick=newRound;$('result-lab').onclick=()=>{labSide=0;lab();};
}

function finish() {
  if(resultRecorded)return;
  resultRecorded=true;book.record[{moss:0,ember:1,draw:2}[game.winner]]++;persist();
  game.emit('field',game.winner==='draw'?'Round drawn.':(game.winner==='moss'?'Moss':'Ember')+' won the round.');
  playTone(440,.12);playTone(game.winner==='moss'?660:330,.18,.12);
  refreshHUD();intel();report();announce(game.events.at(-1).message);
}

function toggleExpanded() {
  const on=$('board-wrap').classList.toggle('expanded');document.body.classList.toggle('field-expanded',on);
  const label=on?'Restore battlefield size':'Expand battlefield';
  $('expand').setAttribute('aria-label',label);$('expand').title=label;
  $('expand').setAttribute('aria-pressed',String(on));
  requestAnimationFrame(()=>field.measure());
}

let stroke=null;
const canvas=$('field');
canvas.tabIndex=0;
canvas.addEventListener('pointerdown',event=>{
  if(game.phase==='over'||game.phase==='paused'||stroke||event.button!==0)return;
  event.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(event.pointerId);
  const point=field.world(event);
  stroke={id:event.pointerId,start:point,samples:[point],dragging:false};
});
canvas.addEventListener('pointermove',event=>{
  const p=field.world(event);
  if(!stroke){field.hover=event.pointerType==='touch'?null:field.target(p);return;}
  if(event.pointerId!==stroke.id)return;
  if(distance(field.screen(p),field.screen(stroke.start))>7)stroke.dragging=true;
  if(stroke.dragging){
    if(distance(p,stroke.samples.at(-1))>12)stroke.samples.push(p);
    field.draft=[NESTS[0],...stroke.samples,p];field.hover=field.target(p);
  }
});
function clearStroke() { stroke=null;field.draft=null;field.hover=null; }
canvas.addEventListener('pointerup',event=>{
  if(!stroke||event.pointerId!==stroke.id)return;
  const point=field.world(event), target=field.target(point);
  giveOrder(target.key,stroke.dragging?stroke.samples:[],target.post?target.at:null);
  clearStroke();if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointercancel',clearStroke);canvas.addEventListener('lostpointercapture',clearStroke);
canvas.addEventListener('pointerleave',()=>{if(!stroke)field.hover=null;});

$('round-action').onclick=action;$('quick-action').onclick=action;$('resume-board').onclick=action;
$('slot-0').onclick=$('quick-1').onclick=()=>selectSlot(0);
$('slot-1').onclick=$('quick-2').onclick=()=>selectSlot(1);
$('destination').onchange=event=>{giveOrder(event.target.value);event.target.selectedIndex=0;};
$('clear').onclick=()=>giveOrder(null);$('expand').onclick=toggleExpanded;
$('guide-button').onclick=guide;$('lab-tab').onclick=()=>{labSide=0;lab();};
$('log-button').onclick=fieldLog;$('field-tab').onclick=()=>canvas.focus({preventScroll:true});
$('sound').onclick=()=>{book.sound=!book.sound;syncSound();playTone(550);persist();};
$('close-dialog').onclick=()=>dialog.close();
dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const b=dialog.getBoundingClientRect();
  if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();
});
dialog.addEventListener('close',()=>{
  if(resumeAfterDialog&&!document.hidden)game.resume();
  resumeAfterDialog=false;previousPhase='';refreshHUD();
});
document.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||event.repeat||dialog.open||['SELECT','INPUT','TEXTAREA'].includes(event.target.tagName))return;
  const key=event.key.toLowerCase();
  if(key==='1'||key==='2'){event.preventDefault();selectSlot(Number(key)-1);}
  else if(event.code==='Space' && event.target.tagName!=='BUTTON'){event.preventDefault();action();}
  else if(key==='h'){event.preventDefault();guide();}
  else if(key==='l'){event.preventDefault();labSide=0;lab();}
  else if(key==='escape' && $('board-wrap').classList.contains('expanded'))toggleExpanded();
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){clearStroke();game.pause();resumeAfterDialog=false;refreshHUD();persist();}
});
window.addEventListener('pagehide',persist);
if(guest){setText('mode-name','Colony challenge');setText('rival-tag','Guest');}
let then=performance.now(), accumulator=0;
function frame(now) {
  const delta=Math.min(.25,Math.max(0,(now-then)/1000));then=now;
  if(game.phase==='live'){
    accumulator+=delta;
    while(accumulator>=1/30 && game.phase==='live'){game.step(1/30);accumulator-=1/30;}
    if(game.phase==='over')finish();
  }else{accumulator=0;}
  if(now-lastUI>150){refreshHUD();lastUI=now;}
  field.draw(game,game.phase==='ready'?now/1000:game.time,slot);
  requestAnimationFrame(frame);
}
drawIcons();syncSound();refreshTrails();refreshHUD();requestAnimationFrame(frame);
if('serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('./sw.js').catch(()=>{});});
