// Interaction pass: modal lesson settings and per-screen scroll positions.
(function () {
  const view = document.getElementById('view');
  if (!view) return;
  const css = document.createElement('style');
  css.textContent = 'dialog.lesson-sheet{position:fixed;inset:auto 0 0;margin:0 auto;width:min(100%,640px);max-width:100%;max-height:85vh;max-height:85dvh;box-sizing:border-box;border:0;border-radius:24px 24px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom,0px));background:var(--tg-theme-bg-color,#fff);color:var(--tg-theme-text-color,#000);overflow:auto}dialog.lesson-sheet::backdrop{background:#0007}.sheet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.sheet-head button{min-width:44px;min-height:44px;border:0;border-radius:12px;background:var(--tg-theme-secondary-bg-color,#eee);color:inherit}.sheet-section{margin:10px 0;padding:8px;border-radius:14px;background:var(--tg-theme-secondary-bg-color,#f1f1f4)}.sheet-section summary{padding:8px;cursor:pointer;font-weight:600}.lesson-sheet button{min-height:44px}.lesson-sheet .linkform{margin-top:0}';
  document.head.append(css);
  let currentSheet = null;
  const oldEditForm = editForm;
  editForm = function (day, item) {
    const form = oldEditForm(day, item);
    const dialog = document.createElement('dialog');
    if (typeof dialog.showModal !== 'function') return form;
    dialog.className = 'lesson-sheet';
    dialog.setAttribute('aria-label','Изменить занятие: ' + item.summary);
    const heading = h('div',{class:'sheet-head'},h('div',{},h('b',{},'Изменить занятие'),h('div',{class:'muted'},item.summary+' · '+day.date+' · '+item.start)));
    dialog.append(heading,form);
    let baseline = '';
    const fields = () => JSON.stringify(Array.from(form.querySelectorAll('input,select,textarea')).map(e=>[e.type,e.value,e.checked]));
    async function close() {
      if (fields() !== baseline && !(await ask('Закрыть без сохранения изменений?'))) return;
      dialog.close();
    }
    heading.append(h('button',{type:'button',onclick:()=>{close().catch(()=>{});},'aria-label':'Закрыть настройки занятия'},'✕'));
    dialog.addEventListener('cancel',e=>{e.preventDefault();close().catch(()=>{});});
    dialog.addEventListener('close',()=>{
      const slot=dialog.parentElement;
      dialog.remove();
      if(slot) slot.dataset.p='';
      if(currentSheet===dialog)currentSheet=null;
    });
    requestAnimationFrame(()=>{
      if(!dialog.isConnected)return;
      // Other scripts have already attached rooms, shifts and preview handlers.
      const nodes=Array.from(form.children);
      let nameMode=false, roomMode=false;
      const buckets={room:[],time:[],name:[],shift:[],danger:[]};
      for(const node of nodes){
        const text=node.textContent.trim();
        if(node.tagName==='BUTTON' && text==='Отменить пару'){buckets.danger.push(node);continue;}
        if(node.classList.contains('shift-box')){buckets.shift.push(node);continue;}
        if(node.tagName==='LABEL' && text.startsWith('Аудитория'))roomMode=true;
        if(roomMode){buckets.room.push(node);continue;}
        if(node.tagName==='LABEL' && text.startsWith('Название предмета'))nameMode=true;
        buckets[nameMode?'name':'time'].push(node);
      }
      for(const [key,title] of [['room','Аудитория'],['time','Дата и время'],['name','Название предмета'],['shift','Сдвиг всех пар'],['danger','Отмена занятия']]){
        if(!buckets[key].length)continue;
        const section=h('details',{class:'sheet-section'},h('summary',{},title));
        section.append(...buckets[key]);
        form.append(section);
      }
      baseline=fields();
      try{dialog.showModal();currentSheet=dialog;}catch(e){dialog.replaceWith(form);}
    });
    return dialog;
  };
  // Scroll memory is session-only. Separate keys for stream, tab and selected date/week.
  const positions=new Map();
  function route(){
    const u=S.boot && S.boot.user || {};
    return [u.course||'',u.stream||'',S.tab,S.tab==='day'?S.date:S.tab==='week'?S.week:''].join('|');
  }
  let active=route(), busy=false, sequence=0;
  window.addEventListener('scroll',()=>{
    if(!busy && !(currentSheet && currentSheet.isConnected))positions.set(active,window.scrollY||0);
  },{passive:true});
  const originalRender=render;
  render=async function(){
    const seq=++sequence;
    const target=route();
    if(!busy)positions.set(active,window.scrollY||0);
    busy=true;
    try{return await originalRender();}
    finally{
      if(seq===sequence){
        active=target;busy=false;
        requestAnimationFrame(()=>{
          if(seq===sequence && route()===target)window.scrollTo({top:positions.get(target)||0,left:0,behavior:'instant'});
        });
      }
    }
  };
})();
