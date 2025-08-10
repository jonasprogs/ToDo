/* ===== Local-first State ===== */
const LS_KEY = 'tb_mvp_state_v1';

const defaultState = {
  settings: { workStart: '08:00', workEnd: '18:00', horizonDays: 14, maxBlockMin: 60 },
  events: [],       // {id,title,start,end,location,busy}
  tasks: [],        // {id,title,durationMin,priority,dueAt?,constraints:{}}
  scheduled: []     // {id,taskId,title,start,end,reason}
};

let state = load() || structuredClone(defaultState);
let deferredPrompt = null;

/* ===== Utilities ===== */
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)); }catch{ return null; } }
const $ = sel => document.querySelector(sel);
function uid(prefix='id'){ return prefix + '_' + Math.random().toString(36).slice(2,9); }
function fmt(dt){ const d=new Date(dt); return d.toLocaleString([], {hour:'2-digit',minute:'2-digit', day:'2-digit', month:'2-digit'}); }
function toDateLocalStr(d){ const z=new Date(d); z.setMinutes(z.getMinutes()-z.getTimezoneOffset()); return z.toISOString().slice(0,16); }
function parseTimeStr(str){ const [h,m]=str.split(':').map(Number); return {h,m}; }
function addMin(date, min){ return new Date(new Date(date).getTime()+min*60000); }
function sameDay(a,b){ a=new Date(a); b=new Date(b); return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function dayStart(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

/* ===== DOM Wiring ===== */
window.addEventListener('DOMContentLoaded', () => {
  // Settings
  $('#workStart').value = state.settings.workStart;
  $('#workEnd').value = state.settings.workEnd;
  $('#horizonDays').value = state.settings.horizonDays;
  $('#maxBlockMin').value = state.settings.maxBlockMin;

  $('#workStart').addEventListener('change', e => { state.settings.workStart = e.target.value; save(); render(); });
  $('#workEnd').addEventListener('change', e => { state.settings.workEnd = e.target.value; save(); render(); });
  $('#horizonDays').addEventListener('change', e => { state.settings.horizonDays = clamp(parseInt(e.target.value||'14',10),1,30); save(); render(); });
  $('#maxBlockMin').addEventListener('change', e => { state.settings.maxBlockMin = clamp(parseInt(e.target.value||'60',10),15,240); save(); });

  // Defaults for forms
  clearEventForm();
  clearTaskForm();

  // Event form
  $('#eventForm').addEventListener('submit', e => {
    e.preventDefault();
    const ev = {
      id: uid('evt'),
      title: $('#evtTitle').value.trim(),
      start: $('#evtStart').value,
      end: $('#evtEnd').value,
      location: $('#evtLocation').value.trim(),
      busy: $('#evtBusy').checked
    };
    if (!ev.title || !ev.start || !ev.end) return;
    if (new Date(ev.end) <= new Date(ev.start)) { alert('Ende muss nach Start liegen.'); return; }
    state.events.push(ev);
    save(); clearEventForm(); render();
  });

  // Task form
  $('#taskForm').addEventListener('submit', e => {
    e.preventDefault();
    const constraints = {
      anchorType: $('#anchorType').value || null,
      anchorValue: ($('#anchorValue').value || '').trim() || null,
      anchorRelation: $('#anchorRelation').value,
      offsetMin: parseInt($('#anchorOffset').value||'0',10),
      sameLocationAsAnchor: $('#sameLoc').checked || false,
      geoFence: parseGeo($('#geoFence').value),
      timeWindow: parseWindow($('#timeWindow').value),
      allowedDays: parseDays($('#allowedDays').value),
      maxDelayAfterAnchorMin: valOrNullInt($('#maxDelayAfter').value)
    };
    const task = {
      id: uid('tsk'),
      title: $('#taskTitle').value.trim(),
      durationMin: parseInt($('#taskDuration').value,10),
      priority: $('#taskPriority').value,
      dueAt: $('#taskDue').value || null,
      constraints
    };
    if (!task.title || !task.durationMin) return;
    state.tasks.push(task);
    save(); clearTaskForm(); render();
  });

  // Controls
  $('#btn-schedule').addEventListener('click', () => { autoSchedule(); });
  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importData);
  $('#btn-reset').addEventListener('click', resetAll);

  // PWA install
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault(); deferredPrompt = e; $('#btn-install').style.display='inline-block';
  });
  $('#btn-install').addEventListener('click', async ()=>{
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(()=>{});
    deferredPrompt = null;
    $('#btn-install').style.display='none';
  });

  // initial render
  render();
});

/* ===== Parsers ===== */
function parseDays(str){
  if (!str) return null;
  const map = {mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun'};
  return str.split(',').map(s=>s.trim().slice(0,3).toLowerCase()).map(s=>map[s]||null).filter(Boolean);
}
function parseWindow(str){
  if (!str) return null;
  const m = str.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return null;
  return {start:m[1], end:m[2]};
}
function parseGeo(str){
  if (!str) return null;
  const p = str.split(',').map(s=>s.trim());
  if (p.length!==3) return null;
  const [lat,lng,rad] = p.map(Number);
  if (Number.isFinite(lat)&&Number.isFinite(lng)&&Number.isFinite(rad)) return {lat,lng,radiusM:rad};
  return null;
}
function valOrNullInt(v){ const n=parseInt(v||'',10); return Number.isFinite(n)?n:null; }

/* ===== Rendering ===== */
function clearEventForm(){
  $('#evtTitle').value='';
  $('#evtLocation').value='';
  const now = new Date();
  const start = new Date(now.getTime()+30*60000);
  const end = new Date(start.getTime()+60*60000);
  $('#evtStart').value = toDateLocalStr(start);
  $('#evtEnd').value = toDateLocalStr(end);
  $('#evtBusy').checked = true;
}
function clearTaskForm(){
  $('#taskTitle').value=''; $('#taskDuration').value=45; $('#taskPriority').value='medium';
  $('#taskDue').value=''; $('#anchorType').value='query'; $('#anchorValue').value='';
  $('#anchorRelation').value='AFTER'; $('#anchorOffset').value=30; $('#sameLoc').checked=false;
  $('#geoFence').value=''; $('#timeWindow').value=''; $('#allowedDays').value=''; $('#maxDelayAfter').value='';
}

function render(){
  renderLists();
  renderWeekGrid();
}
function renderLists(){
  const evc = $('#eventsList'); evc.innerHTML='';
  [...state.events].sort((a,b)=>new Date(a.start)-new Date(b.start)).forEach(ev=>{
    const el = document.createElement('div'); el.className='item';
    el.innerHTML = `
      <div>
        <div><strong>${escapeHtml(ev.title)}</strong> ${ev.busy?'<span class="badge event">Busy</span>':''}</div>
        <div class="meta">${fmt(ev.start)} – ${fmt(ev.end)}${ev.location?` · ${escapeHtml(ev.location)}`:''}</div>
      </div>
      <div class="tags">
        <button data-del-evt="${ev.id}" class="danger">Löschen</button>
        <span class="tag">ID: ${ev.id}</span>
      </div>`;
    evc.appendChild(el);
  });
  evc.querySelectorAll('button[data-del-evt]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.target.getAttribute('data-del-evt');
      state.events = state.events.filter(x=>x.id!==id);
      state.scheduled = state.scheduled.filter(s=>s.sourceEventId!==id);
      save(); render();
    });
  });

  const tc = $('#tasksList'); tc.innerHTML='';
  state.tasks.forEach(t=>{
    const c = t.constraints||{};
    const info = [
      `${t.durationMin}min`,
      c.anchorType?`${c.anchorRelation} ${c.anchorType==="id"?"#"+(c.anchorValue||""):`„${c.anchorValue||''}”`} +${c.offsetMin||0}m`:'ohne Anker',
      c.timeWindow?`${c.timeWindow.start}-${c.timeWindow.end}`:'',
      t.dueAt?`Fällig ${fmt(t.dueAt)}`:''
    ].filter(Boolean).join(' · ');
    const el = document.createElement('div'); el.className='item';
    el.innerHTML = `
      <div>
        <div><strong>${escapeHtml(t.title)}</strong> ${t.priority==='high'?'<span class="badge task">High</span>':''}</div>
        <div class="meta">${info}</div>
      </div>
      <div class="tags">
        <button data-plan-one="${t.id}">Planen</button>
        <button data-del-task="${t.id}" class="danger">Löschen</button>
      </div>`;
    tc.appendChild(el);
  });
  tc.querySelectorAll('button[data-del-task]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.target.getAttribute('data-del-task');
      state.tasks = state.tasks.filter(x=>x.id!==id);
      state.scheduled = state.scheduled.filter(s=>s.taskId!==id);
      save(); render();
    });
  });
  tc.querySelectorAll('button[data-plan-one]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.target.getAttribute('data-plan-one');
      autoSchedule([id]);
    });
  });

  const sc = $('#scheduledList'); sc.innerHTML='';
  [...state.scheduled].sort((a,b)=>new Date(a.start)-new Date(b.start)).forEach(s=>{
    const el = document.createElement('div'); el.className='item';
    el.innerHTML = `
      <div>
        <div><strong>${escapeHtml(s.title)}</strong> <span class="badge task">Task</span></div>
        <div class="meta">${fmt(s.start)} – ${fmt(s.end)}${s.reason?` · ${escapeHtml(s.reason)}`:''}</div>
      </div>
      <div class="tags">
        <button data-del-sch="${s.id}" class="danger">Entplanen</button>
      </div>`;
    sc.appendChild(el);
  });
  sc.querySelectorAll('button[data-del-sch]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.target.getAttribute('data-del-sch');
      state.scheduled = state.scheduled.filter(x=>x.id!==id);
      save(); render();
    });
  });
}

function renderWeekGrid(){
  const grid = $('#weekGrid');
  grid.innerHTML='';

  const start = dayStart(new Date());
  const days = Array.from({length:7}, (_,i)=> new Date(start.getTime()+i*86400000));

  // Header row
  const empty = document.createElement('div'); empty.className='col-head'; empty.textContent='';
  grid.appendChild(empty);
  for (const d of days){
    const h = document.createElement('div'); h.className='col-head';
    h.textContent = d.toLocaleDateString([], {weekday:'short', day:'2-digit', month:'2-digit'});
    grid.appendChild(h);
  }

  // Time rows 6–22
  const dayHours = [...Array(17)].map((_,i)=>i+6); // 6..22
  for (const hr of dayHours){
    const tc = document.createElement('div'); tc.className='time-col';
    tc.textContent = String(hr).padStart(2,'0') + ':00';
    grid.appendChild(tc);

    for (let di=0; di<7; di++){
      const cell = document.createElement('div'); cell.className='cell'; cell.dataset.di=di; cell.dataset.hr=hr;
      grid.appendChild(cell);
    }
  }

  // Helper: place a block in the correct cell for its start hour
  function place(startDt, endDt, cls, title, subtitle){
    const s = new Date(startDt), e = new Date(endDt);
    const base = dayStart(new Date());
    const di = Math.floor((dayStart(s) - base)/86400000);
    if (di<0 || di>6) return; // only show current week
    const hr = clamp(s.getHours(), 6, 22);
    const dayHoursArr = dayHours;
    const rowIndex = dayHoursArr.indexOf(hr);
    if (rowIndex<0) return;
    // index in grid: header row (8) + rows of (1+7)
    const cell = grid.children[(1+7) + rowIndex*(1+7) + 1 + di];
    if (!cell) return;

    const block = document.createElement('div');
    block.className = `block ${cls}`;
    const sHM = s.toTimeString().slice(0,5), eHM = e.toTimeString().slice(0,5);
    block.innerHTML = `<div class="t">${escapeHtml(title)}</div><div class="s">${sHM}–${eHM}${subtitle?` · ${escapeHtml(subtitle)}`:''}</div>`;
    const topPct = (s.getMinutes()/60)*100;
    const durMin = Math.max(30, (e - s)/60000);
    const heightPct = Math.min(200, (durMin/60)*100);
    block.style.top = `${topPct*0.9}%`;
    block.style.height = `${heightPct}%`;
    cell.appendChild(block);
  }

  state.events.forEach(ev=> place(ev.start, ev.end, 'event', ev.title, ev.location || ''));
  state.scheduled.forEach(s=> place(s.start, s.end, 'task', s.title, s.reason || ''));
}

/* ===== Scheduling ===== */
function autoSchedule(onlyTaskIds=null){
  $('#schedule-status').textContent = 'Plane…';

  // clear prior schedule for these tasks
  if (onlyTaskIds){
    state.scheduled = state.scheduled.filter(s=>!onlyTaskIds.includes(s.taskId));
  } else {
    state.scheduled = [];
  }
  const now = new Date();
  const horizonDays = state.settings.horizonDays;

  // Build busy map per day
  const busy = {};
  for (let i=0;i<horizonDays;i++){
    const d = dayStart(addMin(now, i*24*60)).toISOString();
    busy[d] = [];
  }
  // Insert events as busy (if busy flag)
  state.events.forEach(ev=>{
    if (!ev.busy) return;
    const s = new Date(ev.start), e = new Date(ev.end);
    if (e<=now) return; // ignore past
    pushBusy(busy, s, e);
  });
  function pushBusy(bmap, s, e){
    let cur = dayStart(s);
    while (cur<=e){
      const dayKey = dayStart(cur).toISOString();
      if (bmap[dayKey]){
        const ds = new Date(Math.max(s, cur));
        const de = new Date(Math.min(e, addMin(cur, 24*60-1)));
        bmap[dayKey].push([ds,de]);
      }
      cur = addMin(cur, 24*60);
    }
  }

  // Working hours
  const {h:whs, m:wms} = parseTimeStr(state.settings.workStart);
  const {h:whe, m:wme} = parseTimeStr(state.settings.workEnd);

  // Sort tasks: prio, due, duration
  const prioRank = {high:0, medium:1, low:2};
  let tasks = onlyTaskIds ? state.tasks.filter(t=>onlyTaskIds.includes(t.id)) : [...state.tasks];
  tasks.sort((a,b)=>{
    const pa = prioRank[a.priority]??9, pb = prioRank[b.priority]??9;
    if (pa!==pb) return pa-pb;
    const da = a.dueAt? new Date(a.dueAt): new Date('2999-01-01');
    const db = b.dueAt? new Date(b.dueAt): new Date('2999-01-01');
    if (da-db) return da-db;
    return (b.durationMin||0)-(a.durationMin||0);
  });

  const plannedNow = [];
  for (const t of tasks){
    const c = t.constraints || {};
    // Resolve anchor
    let anchor = null;
    if (c.anchorType==='id' && c.anchorValue){
      anchor = state.events.find(e=>e.id===c.anchorValue) || null;
    } else if (c.anchorType==='query' && c.anchorValue){
      const q = c.anchorValue.toLowerCase();
      anchor = state.events.find(e =>
        (e.title||'').toLowerCase().includes(q) ||
        (e.location||'').toLowerCase().includes(q)
      ) || null;
    }

    // Compute earliest & latest
    let earliest = now;
    let latestEnd = null;

    if (anchor){
      const aStart = new Date(anchor.start), aEnd = new Date(anchor.end);
      if (c.anchorRelation==='AFTER'){
        earliest = addMin(aEnd, c.offsetMin||0);
        if (c.maxDelayAfterAnchorMin!=null){
          latestEnd = addMin(earliest, c.maxDelayAfterAnchorMin);
        }
      } else { // BEFORE
        latestEnd = addMin(aStart, -1 * (c.offsetMin||0));
        earliest = now;
      }
    }

    let remain = t.durationMin;
    for (let di=0; di<horizonDays && remain>0; di++){
      const day = dayStart(addMin(now, di*24*60));
      const dayKey = day.toISOString();

      // allowed days
      if (c.allowedDays && c.allowedDays.length>0){
        const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()];
        if (!c.allowedDays.includes(wd)) continue;
      }

      // working window
      const workStart = new Date(day); workStart.setHours(whs,wms,0,0);
      const workEnd = new Date(day); workEnd.setHours(whe,wme,0,0);

      // cut by earliest/latestEnd
      const dayWinStart = new Date(Math.max(workStart, earliest));
      let dayWinEnd = workEnd;
      if (latestEnd) dayWinEnd = new Date(Math.min(dayWinEnd, latestEnd));
      if (dayWinEnd <= dayWinStart) continue;

      // timeWindow
      let windowStart = dayWinStart, windowEnd = dayWinEnd;
      if (c.timeWindow){
        const {h:twsh,m:twsm} = parseTimeStr(c.timeWindow.start);
        const {h:tweh,m:twem} = parseTimeStr(c.timeWindow.end);
        const twS = new Date(day); twS.setHours(twsh,twsm,0,0);
        const twE = new Date(day); twE.setHours(tweh,twem,0,0);
        windowStart = new Date(Math.max(windowStart, twS));
        windowEnd   = new Date(Math.min(windowEnd, twE));
        if (windowEnd <= windowStart) continue;
      }

      // sameLocationAsAnchor (heuristik)
      if (c.sameLocationAsAnchor && anchor){
        const aLoc = (anchor.location||'').trim().toLowerCase();
        if (aLoc){ /* Heuristik ok */ } else { /* nicht verifizierbar, nicht blockieren */ }
      }

      // freie Intervalle
      const intervals = mergeFreeIntervals(windowStart, windowEnd, busy[dayKey], state.scheduled);

      // allocate
      while (remain>0 && intervals.length){
        const [is, ie] = intervals.shift();
        const slotMin = Math.floor((ie - is)/60000);
        if (slotMin <= 0) continue;

        const chunk = Math.min(remain, Math.min(slotMin, state.settings.maxBlockMin));
        const s = new Date(is);
        const e = addMin(s, chunk);

        state.scheduled.push({
          id: uid('sch'),
          taskId: t.id,
          title: t.title,
          start: s.toISOString(),
          end: e.toISOString(),
          reason: anchor ? `${c.anchorRelation} „${anchor.title}“ +${c.offsetMin||0}m` : 'ohne Anker'
        });
        // markiert als busy
        pushBusy(busy, s, e);

        remain -= chunk;
        if (e < ie) intervals.unshift([e, ie]); // rest zurück
      }
    }

    if (remain>0){
      $('#schedule-status').textContent = `Nicht komplett planbar: ${t.title} (fehlend ${remain} Min).`;
    } else {
      plannedNow.push(t.title);
    }
  }

  save(); render();
  if (plannedNow.length){
    $('#schedule-status').textContent = `Geplant: ${plannedNow.join(', ')}`;
  } else if (!state.tasks.length){
    $('#schedule-status').textContent = 'Keine Tasks vorhanden.';
  }
}

function mergeFreeIntervals(winStart, winEnd, busyList, scheduledList){
  const blocks = [];
  (busyList||[]).forEach(([s,e])=>{
    if (e<=winStart || s>=winEnd) return;
    blocks.push([new Date(Math.max(s,winStart)), new Date(Math.min(e,winEnd))]);
  });
  (scheduledList||[]).forEach(s=>{
    const ss=new Date(s.start), ee=new Date(s.end);
    if (ee<=winStart || ss>=winEnd) return;
    blocks.push([new Date(Math.max(ss,winStart)), new Date(Math.min(ee,winEnd))]);
  });
  blocks.push([winStart,winStart]); blocks.push([winEnd,winEnd]);

  blocks.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for (const b of blocks){
    if (!merged.length || b[0] > merged[merged.length-1][1]){
      merged.push([...b]);
    } else {
      merged[merged.length-1][1] = new Date(Math.max(merged[merged.length-1][1], b[1]));
    }
  }

  const free=[];
  for (let i=0;i<merged.length-1;i++){
    const endA = merged[i][1], startB = merged[i+1][0];
    if (startB > endA) free.push([endA, startB]);
  }
  return free;
}

/* ===== Export / Import / Reset ===== */
function exportData(){
  const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `tb_mvp_export_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}
function importData(e){
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      // simple validation
      if (!data || !data.settings || !Array.isArray(data.events) || !Array.isArray(data.tasks) || !Array.isArray(data.scheduled)){
        alert('Ungültige Datei.');
        return;
      }
      state = data;
      save(); render();
      $('#schedule-status').textContent = 'Import erfolgreich.';
    }catch(err){
      console.error(err); alert('Konnte Datei nicht lesen.');
    }
  };
  reader.readAsText(f);
}
function resetAll(){
  if (!confirm('Wirklich alle Daten löschen?')) return;
  state = structuredClone(defaultState);
  save(); render();
  $('#schedule-status').textContent = 'Zurückgesetzt.';
}