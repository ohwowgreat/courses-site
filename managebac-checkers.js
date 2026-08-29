// Paste into the ManageBac tab after expected.json is in localStorage as __EXP_<course>.
window.__norm = h => h.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
  .replace(/&rsquo;/g,'’').replace(/&hellip;/g,'…').replace(/\s+/g,' ').trim();
window.__djb2 = s => { let h=5381; for(let i=0;i<s.length;i++) h=((h*33)^s.charCodeAt(i))>>>0; return h; };
window.__X = c => JSON.parse(localStorage.getItem('__EXP_'+c));

// Lessons: run on a unit's Lessons & Resources page.
window.__fast = async (course) => {
  const d=document, sleep=ms=>new Promise(r=>setTimeout(r,ms));
  for(const t of [...d.querySelectorAll('[data-bs-toggle=collapse],[aria-controls*=collapse]')]) { try{t.click();}catch(e){} }
  await sleep(3000);
  const X=__X(course); const out=[];
  for(const row of [...d.querySelectorAll('[id^=stream_plan_]')].filter(e=>/^L\d\d/.test(e.innerText.trim()))){
    const title=row.innerText.trim().split('\n')[0].trim(); const code=title.slice(0,3); const n=+code.slice(1);
    const E=X.lessons[n]; if(!E){ out.push(code+':NOT-EXPECTED'); continue; }
    const views=[...row.querySelectorAll('.fr-view.fr-element')]; const el=views[views.length-1];
    if(!el){ out.push(code+':NO-BODY'); continue; }
    const got=__norm(el.innerHTML); const probs=[];
    if(title!==E.title) probs.push('title');
    if(__djb2(got)!==E.h) probs.push('body('+E.len+'/'+got.length+')');
    out.push(code+':'+(probs.length?probs.join(','):'OK'));
  }
  return out.join(' ');
};

// Unit description: run on a unit's planner page.
window.__fastU = (course,n) => {
  const d=document; const E=__X(course).units[n]; if(!E) return 'NO-EXPECTED';
  const sec=d.querySelector('.unit-section.summary'); if(!sec) return 'NO-SECTION';
  const el=sec.querySelector('.fr-view'); if(!el) return 'NO-BODY';
  const got=__norm(el.innerHTML);
  return 'U'+n+':'+(__djb2(got)===E.h ? 'OK' : 'body('+E.len+'/'+got.length+')');
};

// Tasks: run on a class's core_tasks page. Titles only; counts catch the rest.
window.__fastT = (course) => {
  const d=document; const X=__X(course); const seen=new Set(); const got=[];
  for(const a of d.querySelectorAll('a')){ const h=a.getAttribute('href')||'';
    if(!/\/core_tasks\/\d+/.test(h)) continue;
    const id=h.match(/core_tasks\/(\d+)/)[1]; if(seen.has(id)) continue;
    const txt=a.textContent.replace(/\s+/g,' ').trim();
    if(!txt||/^(Edit|Gradebook|Discussions|Delete|Duplicate)$/i.test(txt)) continue;
    seen.add(id); got.push(txt); }
  const want=X.tasks.map(t=>t.title);
  const missing=want.filter(w=>!got.includes(w)), extra=got.filter(g=>!want.includes(g));
  return 'want '+want.length+' got '+got.length
    + (missing.length?' | MISSING: '+missing.join(' ; '):'')
    + (extra.length?' | EXTRA: '+extra.join(' ; '):'');
};
