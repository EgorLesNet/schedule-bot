// Visual pass: lesson hierarchy, consistent metadata icons and density setting.
(function () {
  const view = document.getElementById('view');
  if (!view) return;
  const userId = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'local');
  const key = 'schedule:density:' + userId;
  let density = 'normal';
  try { if (localStorage.getItem(key) === 'compact') density = 'compact'; } catch(e) {}
  document.documentElement.dataset.density = density;
  const style = document.createElement('style');
  style.textContent = '.lesson{gap:14px;padding:16px 0 16px 10px}.lesson>.time{min-width:60px;display:flex;flex-direction:column;gap:4px;font-size:14px;line-height:1.3}.lesson>.time .ui-start{font-size:17px;font-weight:650;color:var(--tg-theme-text-color,#000)}.lesson>.grow>b{display:inline-block;font-size:17px;line-height:1.35;margin-bottom:5px}.ui-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:4px 0 8px}.ui-meta-item{display:inline-flex;align-items:center;gap:5px;max-width:100%;overflow-wrap:anywhere}.ui-room{padding:4px 8px;border-radius:8px;background:var(--tg-theme-bg-color,#fff);color:var(--tg-theme-text-color,#000)}.ui-icon{width:17px;height:17px;flex-shrink:0;vertical-align:middle;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.lesson button.mini{min-height:44px;min-width:44px;box-sizing:border-box}.ui-density-options{display:flex;gap:8px}.ui-density-options button{min-height:44px}.ui-density-options button[aria-pressed=true]{outline:2px solid var(--tg-theme-button-color,#2481cc);outline-offset:2px}[data-density=compact] .lesson{padding-top:9px;padding-bottom:9px;gap:10px}[data-density=compact] .lesson>.grow>b{font-size:16px;margin-bottom:2px}[data-density=compact] .ui-meta{margin:2px 0 4px;font-size:13px}';
  document.head.append(style);
  const paths = {
    room:'M3 21h18M5 21V4h14v17M9 8h1M14 8h1M9 12h1M14 12h1M10 21v-5h4v5',
    teacher:'M8 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M4 21v-2a8 8 0 0 1 16 0v2',
    homework:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',
    note:'M4 3h16v14l-4 4H4zM8 8h8M8 12h6',
    link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('class','ui-icon');
    svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',paths[name]); svg.append(path); return svg;
  }
  function decorate() {
    for (const row of view.querySelectorAll('.lesson')) {
      const time = row.querySelector(':scope > .time');
      if (time && !time.dataset.uiTime) {
        const match = /^(\d{2}:\d{2})[–—-](\d{2}:\d{2})$/.exec(time.textContent.trim());
        if (match) {
          time.dataset.uiTime = '1';
          // Preserve textContent for existing scripts that read HH:MM–HH:MM.
          const start = document.createElement('span'); start.className='ui-start'; start.textContent=match[1];
          const dash = document.createElement('span'); dash.textContent='–'; dash.style.display='none';
          const end = document.createElement('span'); end.textContent=match[2];
          time.replaceChildren(start,dash,end);
          time.setAttribute('aria-label',match[1]+' — '+match[2]);
        }
      }
      const body = row.querySelector(':scope > .grow');
      if (!body) continue;
      for (const meta of Array.from(body.children).filter(e=>e.classList.contains('muted'))) {
        if (meta.dataset.uiMeta) continue;
        meta.dataset.uiMeta='1';
        // Keep original text for room.js and text-based selectors; replace emoji visually only.
        const raw = meta.textContent;
        if (!/👤|🏫/.test(raw)) continue;
        meta.classList.add('ui-meta');
        const fragments = raw.split(' · ');
        meta.replaceChildren();
        fragments.forEach((text,i)=>{
          if(i) { const sep=document.createElement('span'); sep.textContent=' · '; sep.style.display='none'; meta.append(sep); }
          const kind = text.includes('🏫') ? 'room' : text.includes('👤') ? 'teacher' : null;
          const part=document.createElement('span'); part.className='ui-meta-item'+(kind==='room'?' ui-room':'');
          if(kind) part.append(icon(kind));
          const marker=document.createElement('span'); marker.style.display='none'; marker.textContent=kind==='room'?'🏫 ':kind==='teacher'?'👤 ':'';
          part.append(marker,document.createTextNode(text.replace(/^[👤🏫\s]+/u,'').trim()));
          meta.append(part);
        });
      }
      for(const [selector,kind] of [['.hw','homework'],['.note','note']]) {
        const content=body.querySelector(':scope > '+selector);
        if(!content || content.dataset.uiIcon) continue;
        content.dataset.uiIcon='1';
        const first=content.firstChild;
        if(first && first.nodeType===3) {
          const match=/^(📝|🗒)\s*/u.exec(first.textContent);
          if(match) { const hidden=document.createElement('span'); hidden.hidden=true; hidden.textContent=match[0]; first.textContent=first.textContent.slice(match[0].length); content.insertBefore(hidden,first); }
        }
        content.prepend(icon(kind));
      }
    }
    if(S.tab==='set' && !view.querySelector('.ui-density-card') && view.querySelector('.alerts-card')) {
      const card=h('section',{class:'card ui-density-card'},h('h3',{},'Вид расписания'),h('p',{class:'muted'},'Компактный режим уменьшает отступы, но сохраняет удобные области нажатия.'));
      const options=h('div',{class:'ui-density-options'});
      for(const [value,label] of [['normal','Обычный'],['compact','Компактный']]) {
        const btn=h('button',{class:'alt','aria-pressed':String(density===value),onclick:()=>{
          density=value;document.documentElement.dataset.density=value;
          try{localStorage.setItem(key,value)}catch(e){}
          for(const b of options.children)b.setAttribute('aria-pressed',String(b===btn));
          buzz.pick();
        }},label);
        options.append(btn);
      }
      card.append(options);
      const anchor=view.querySelector('[data-ux-group="schedule"] .ux-body') || view.firstElementChild || view;
      anchor.append(card);
    }
  }
  let pending=false;
  new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;decorate()})}).observe(view,{childList:true,subtree:true});
  decorate();
})();
