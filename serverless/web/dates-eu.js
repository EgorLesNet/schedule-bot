// European date presentation; ISO values remain unchanged in API/storage.
(function () {
  const view=document.getElementById('view');
  if(!view)return;
  const css=document.createElement('style');
  css.textContent='.eu-date{width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border-radius:12px;border:1px solid #8886;background:var(--tg-theme-bg-color,#fff);color:inherit;font-size:16px}.eu-date[aria-invalid=true]{border-color:#d33}.eu-date-error{color:#d33;font-size:13px;margin:4px 0}';
  document.head.append(css);
  function display(iso){return /^(\d{4})-(\d{2})-(\d{2})$/.test(iso)?iso.split('-').reverse().join('.'):'';}
  function parse(text){
    const m=/^(\d{2})[./](\d{2})[./](\d{4})$/.exec(text.trim());
    if(!m)return '';
    const d=Number(m[1]),month=Number(m[2]),year=Number(m[3]);
    if(year<1||month<1||month>12||d<1)return '';
    const leap=year%4===0&&(year%100!==0||year%400===0);
    const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(d>days[month-1])return '';
    return m[3]+'-'+m[2]+'-'+m[1];
  }
  function enhance(native){
    if(native.dataset.euDate)return;
    native.dataset.euDate='1';
    native.hidden=true;
    const field=document.createElement('input');
    // Not type=text: room.js/plan.js use the first text input as subject name.
    field.type='tel';field.inputMode='numeric';field.className='eu-date';field.maxLength=10;
    field.placeholder='ДД.ММ.ГГГГ';field.value=display(native.value);
    field.setAttribute('aria-label','Дата, день месяц год');
    const error=document.createElement('div');error.className='eu-date-error';error.hidden=true;
    native.after(field,error);
    let editing=false;
    function commit(){
      editing=true;
      const raw=field.value.trim(),iso=parse(raw);
      let message=raw&&!iso?'Введите существующую дату в формате ДД.ММ.ГГГГ':'';
      if(iso&&native.min&&iso<native.min)message='Дата не раньше '+display(native.min);
      if(iso&&native.max&&iso>native.max)message='Дата не позже '+display(native.max);
      if(!raw&&native.required)message='Укажите дату';
      field.setCustomValidity(message);field.setAttribute('aria-invalid',String(!!message));
      error.textContent=message;error.hidden=!message;
      // Invalid text must not silently replace the valid source date.
      if(!message){native.value=iso;native.dispatchEvent(new Event('input',{bubbles:true}));native.dispatchEvent(new Event('change',{bubbles:true}));}
      editing=false;
    }
    field.addEventListener('input',()=>{
      if(/^\d+$/.test(field.value)){
        const digits=field.value.slice(0,8);
        field.value=digits.slice(0,2)+(digits.length>2?'.'+digits.slice(2,4):'')+(digits.length>4?'.'+digits.slice(4):'');
      }
      commit();
    });
    field.addEventListener('blur',()=>{commit();if(field.checkValidity())field.value=display(native.value);});
    native.addEventListener('change',()=>{if(!editing){field.value=display(native.value);field.setCustomValidity('');field.setAttribute('aria-invalid','false');error.hidden=true;}});
  }
  // Prevent saving an invalid visible date even when original handlers skip form validation.
  view.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button||/Закрыть|Назад|Сбросить|Отменить пару|✕/.test(button.textContent))return;
    const scope=button.closest('.linkform,section.card,dialog')||view;
    const bad=Array.from(scope.querySelectorAll('.eu-date')).find(e=>!e.checkValidity());
    if(bad){event.preventDefault();event.stopImmediatePropagation();bad.reportValidity();bad.focus();}
  },true);
  function update(){
    for(const input of view.querySelectorAll('input[type=date]'))enhance(input);
    // Only structured date labels, never homework, notes, URLs or stored values.
    for(const label of view.querySelectorAll('.sheet-head .muted,[data-ux-group="changes"] .erow>span')){
      for(const node of Array.from(label.childNodes))if(node.nodeType===3){
        const value=node.textContent.replace(/\b\d{4}-\d{2}-\d{2}\b/g,match=>display(match)||match);
        if(value!==node.textContent)node.textContent=value;
      }
    }
  }
  let queued=false;
  new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;update();})}).observe(view,{childList:true,subtree:true});
  update();
})();
