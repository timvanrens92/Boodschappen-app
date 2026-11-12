import './style.css';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const BASE = import.meta.env.BASE_URL;

const sb = createClient(SUPABASE_URL || 'https://ontbreekt.supabase.co', SUPABASE_ANON_KEY || 'ontbreekt', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* ---------- service worker + pushmeldingen ---------- */
let swReg = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).then(r => { swReg = r; }).catch(() => {});
}
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function pushState() {
  if (!VAPID_PUBLIC_KEY) return 'nokey';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  try {
    const reg = swReg || (await navigator.serviceWorker.ready);
    const sub = await reg.pushManager.getSubscription();
    if (sub) return 'on';
    return Notification.permission === 'denied' ? 'denied' : 'off';
  } catch (_) { return 'unsupported'; }
}
async function togglePush() {
  const st = await pushState();
  if (st === 'nokey' || st === 'unsupported' || st === 'denied') { S.push = st; return; }
  const reg = swReg || (await navigator.serviceWorker.ready);
  if (st === 'on') {
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    S.push = 'off'; toast('Meldingen staan uit op dit toestel'); return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { S.push = perm === 'denied' ? 'denied' : 'off'; toast('Meldingen zijn niet toegestaan'); return; }
  try {
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, subscription: j, user_id: ME });
    if (error) throw error;
    S.push = 'on'; toast('Meldingen staan aan op dit toestel');
  } catch (e) { S.push = 'off'; toast('Meldingen aanzetten lukte niet. Probeer het opnieuw.'); }
}

/* ---------- inloggen ---------- */
function showLogin(msg) {
  document.getElementById('app').hidden = true;
  document.getElementById('login').hidden = false;
  const m = document.getElementById('loginMsg');
  m.textContent = msg || ''; m.hidden = !msg;
}
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPass').value;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { showLogin('De app is nog niet gekoppeld aan Supabase. Zie de handleiding (stap 5).'); return; }
  btn.disabled = true; btn.textContent = 'Bezig…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Inloggen';
  if (error) { showLogin(error.message === 'Invalid login credentials' ? 'E-mailadres of wachtwoord klopt niet.' : 'Inloggen lukte niet: ' + error.message); return; }
  startApp(data.session);
});

const STAPLES=["Halfvolle melk","Volle melk","Karnemelk","Yoghurt","Kwark","Boter","Eieren","Jonge kaas","Belegen kaas","Kaas plakken","Brood","Volkorenbrood","Krentenbollen","Beschuit","Hagelslag","Pindakaas","Jam","Appelstroop","Koffie","Koffiebonen","Thee","Suiker","Bloem","Rijst","Pasta","Spaghetti","Macaroni","Tomatenblokjes","Pastasaus","Bouillonblokjes","Olijfolie","Zonnebloemolie","Mayonaise","Ketchup","Mosterd","Aardappelen","Krieltjes","Uien","Knoflook","Wortelen","Broccoli","Bloemkool","Sperziebonen","Komkommer","Tomaten","Paprika","Sla","IJsbergsla","Spinazie","Champignons","Prei","Courgette","Andijvie","Boerenkool","Appels","Bananen","Peren","Mandarijnen","Druiven","Kiwi","Avocado","Citroen","Kipfilet","Gehakt","Rookworst","Speklappen","Hamburgers","Zalmfilet","Vissticks","Ham","Kipfilet beleg","Pizza","Chips","Koekjes","Chocolade","Vla","Frisdrank","Cola","Sinaasappelsap","Bier","Wijn","Water","Wc-papier","Keukenrol","Afwasmiddel","Vaatwastabletten","Wasmiddel","Tandpasta","Shampoo","Luiers","Billendoekjes","Vuilniszakken"];

const S={offers:[],list:[],items:[],lists:[],cur:'main',newList:false,listRen:false,listDel:false,trips:[],templates:[],tplFromTrip:null,tplDel:null,tplOver:null,tplRen:null,prices:{},meta:null,tab:'lijst',store:'all',oq:'',finishing:false,confirmClear:false,sugIdx:-1,sugs:[]};
let ME=null, MYNAME='', LOCAL=false, loaded=false;
const NAMES={};
async function resolveNames(){
  const ids=[...new Set(S.items.map(i=>i.addedBy).filter(id=>id&&id!==ME&&!(id in NAMES)))];
  if(!ids.length) return;
  ids.forEach(id=>NAMES[id]='');
  try{const {data}=await sb.from('profiles').select('id,name').in('id',ids); (data||[]).forEach(p=>NAMES[p.id]=p.name||''); render();}catch(_){}
}
const whoName=id=>NAMES[id]||'Iemand anders';
const listOf=i=>i.listId||'main';
function allLists(){const m=S.lists.find(l=>l.id==='main');const others=S.lists.filter(l=>l.id!=='main').sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  return [{id:'main',name:(m&&m.name)||'Boodschappen',advice:m?m.advice!==false:true},...others.map(l=>({...l,advice:l.advice===true}))];}
function curList(){const L=allLists();return L.find(l=>l.id===S.cur)||L[0];}
const ADV=()=>curList().advice;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur=n=>n==null||isNaN(n)?'':'€ '+Number(n).toFixed(2).replace('.',',');
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const slug=s=>norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'x';
const today=()=>new Date().toISOString().slice(0,10);
const STOP=new Set(['alle','van','met','voor','jumbo','jumbos','plus','biologische','biologisch','kies','mix','per','stuk','stuks','zak','zakken','pak','pakken','fles','flessen','pot','uit','het','een','neutraal','verse','vers','extra']);
const stem=t=>t.replace(/(tjes|jes|en|es|s|e)$/,'');
const toks=s=>norm(s).split(/[^a-z0-9]+/).filter(t=>t.length>=3&&!STOP.has(t)).map(stem).filter(t=>t.length>=3);
const activeOffer=o=>!o.validTo||o.validTo>=today();

/* ---------- storage adapter ---------- */
const K=c=>c==='list'?'items':c;
const T=c=>c==='list'?'items':c;
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
async function q(p){const {error}=await p; if(error) throw error;}
const store={
  async add(col,data){ const id=uid(); S[K(col)].push({id,...data}); render(); await q(sb.from(T(col)).insert({id,data})); },
  async upd(col,id,patch){ const it=S[K(col)].find(x=>x.id===id); if(!it) return; Object.assign(it,patch); render(); const {id:_i,...d}=it; await q(sb.from(T(col)).update({data:d}).eq('id',id)); },
  async del(col,id){ S[K(col)]=S[K(col)].filter(x=>x.id!==id); render(); await q(sb.from(T(col)).delete().eq('id',id)); },
  async put(col,id,data){ const a=S[K(col)];const i=a.findIndex(x=>x.id===id); if(i>=0)a[i]={id,...data}; else a.push({id,...data}); render(); await q(sb.from(T(col)).upsert({id,data})); },
  async price(key,data){ S.prices[key]={...(S.prices[key]||{}),...data}; await q(sb.from('prices').upsert({id:key,data:S.prices[key]})); }
};
function note(msg){const n=$('notice'); n.textContent=msg||''; n.hidden=!msg;}
async function safe(p){try{await p}catch(e){note(e&&e.code==='quota_exceeded'?'De opslag is vol. Verwijder oude boodschappenrondes in "Eerder".':'Opslaan lukte niet. Probeer het zo opnieuw.')}}

/* ---------- gangpaden ---------- */
const DEPTS=['Groente en fruit','Brood en gebak','Vleeswaren en kaas','Zuivel en eieren','Vlees, vis en vega','Maaltijden','Voorraadkast','Ontbijt en beleg','Koek, snoep en chips','Dranken','Diepvries','Drogisterij en huishouden','Overig'];
const CATMAP={'Groente en fruit':0,'Brood en gebak':1,'Vleeswaren':2,'Kaas':2,'Zuivel':3,'Vlees, vis en vega':4,'Maaltijden':5,'Voorraadkast':6,'Conserven':6,'Sauzen':6,'Wereldkeuken':6,'Ontbijt':7,'Chips en snacks':8,'Snoep en chocolade':8,'Koek':8,'Frisdrank':9,'Bier':9,'Wijn':9,'Sterke drank':9,'Koffie en thee':7,'Diepvries':10,'Drogisterij en huishouden':11,'Drogisterij':11,'Huishouden':11};
const DEPT_KW=[
 [0,'aardappel krieltjes ui uien knoflook wortel peen winterpeen broccoli bloemkool sperzie boontjes komkommer tomaat tomaten paprika sla ijsberg rucola veldsla spinazie champignon prei courgette aubergine andijvie boerenkool spruit witlof kool spitskool rode biet selderij knolselderij gember citroen limoen appel banaan bananen peer peren mandarijn sinaasappel druif druiven kiwi avocado mango ananas aardbei framboos bessen meloen fruit groente kruiden peterselie basilicum koriander bieslook hutspot zuurkool rauwkost snoeptomaat'],
 [1,'brood volkoren bolletjes broodjes stokbrood croissant krentenbol beschuit cracker knackebrod wraps tortilla pistolet taart gebak cake ontbijtkoek tompouce flatbread'],
 [2,'kaas ham kipfilet beleg salami boterhamworst leverworst filet americain pate rosbief cervelaat smeerkaas roomkaas feta mozzarella parmezaan geraspte'],
 [3,'melk halfvolle volle karnemelk yoghurt kwark vla boter roomboter margarine room slagroom kookroom creme fraiche eieren ei pap drinkyoghurt chocomel havermelk'],
 [4,'gehakt kip kipfilet kippendij drumstick rundvlees biefstuk speklap spek bacon varkensvlees shoarma hamburger burger worst rookworst braadworst slavink schnitzel riblap sukade stoofvlees zalm vis kabeljauw garnalen tonijn forel vleesvervanger tofu tempeh vegetarisch spareribs saté'],
 [5,'maaltijd salade soep stamppot lasagne pizza verse pasta maaltijdpakket verspakket bapao loempia'],
 [6,'rijst pasta spaghetti macaroni penne noedels bloem suiker zout peper olie olijfolie azijn ketchup mayonaise mosterd saus pastasaus tomatenblokjes tomatenpuree bouillon kruidenmix mix bonen kikkererwten mais doperwten blik pot conserven sambal sojasaus kokosmelk wokssaus woksaus taco'],
 [7,'koffie thee hagelslag pindakaas jam honing appelstroop muesli cruesli havermout cornflakes ontbijt nutella vlokken'],
 [8,'chips nootjes pinda koek koekjes chocolade snoep drop reep popcorn borrel toastjes kruidnoten speculaas'],
 [9,'water cola frisdrank sap sinaasappelsap appelsap limonade ranja siroop bier wijn ice tea energy fris'],
 [10,'diepvries ijs patat friet frites nuggets vissticks kroket frikandel bitterballen diepvriesgroente'],
 [11,'wc toiletpapier keukenrol tissues papier afwasmiddel vaatwas wasmiddel wasverzachter schoonmaak allesreiniger spons vuilniszak tandpasta tandenborstel shampoo conditioner douchegel zeep deodorant scheermes maandverband luiers billendoekjes pleisters batterijen lamp kaars aluminiumfolie folie bakpapier']
].map(([d,w])=>[d,w.split(' ')]);
function deptOf(name){
  const n=norm(name), words=n.split(/[^a-z0-9]+/).filter(Boolean);
  const m=matchOffers(name)[0]; if(m&&m.o.category&&CATMAP[m.o.category]!=null) return CATMAP[m.o.category];
  for(const [d,ws] of DEPT_KW){ for(const w of ws){ if(words.some(x=>x===w||(w.length>=4&&x.startsWith(w))||(w.length>=5&&x.endsWith(w)))) return d; } }
  return DEPTS.length-1;
}
const cmpItems=(a,b)=>(a.done-b.done)||(a.done?0:deptOf(a.name)-deptOf(b.name))||(a.addedAt-b.addedAt);
function itemsHTML(items){
  let last=null, out='';
  for(const i of items){
    if(!i.done){const d=deptOf(i.name); if(d!==last){out+=`<li class="dept" aria-hidden="true">${DEPTS[d]}</li>`; last=d;}}
    else if(last!=='done'){ if(items.some(x=>!x.done)) out+=`<li class="dept" aria-hidden="true">In het mandje</li>`; last='done'; }
    out+=itemHTML(i);
  }
  return out;
}

/* ---------- matching & advice ---------- */
const SYN={melk:['langlekker','halfvolle','volle','karnemelk'],wc:['toiletpapier'],toiletpapier:['page','wc-papier'],cola:['coca-cola','pepsi'],chips:['croky','lays','chio','pringles','doritos'],pizza:['wagner','crosta'],kaas:['beemster','klaverland','parrano','gouda'],wasmiddel:['ariel','robijn','persil'],koffie:['douwe','aroma','senseo'],olijfolie:['bertolli'],boter:['blue','band','roomboter']};
function matchOffers(name){
  const nn=norm(name).trim();
  let it=toks(name); if(!it.length) return [];
  const extra=[]; it.forEach(t=>Object.keys(SYN).forEach(k=>{if(stem(k)===t)SYN[k].forEach(x=>extra.push(...toks(x)))}));
  return S.offers.filter(activeOffer).map(o=>{
    const ot=toks(o.name+' '+(o.keywords||[]).join(' '));
    if((o.keywords||[]).some(k=>norm(k)===nn)) return {o,score:1.1};
    const hit=it.filter(t=>ot.some(x=>x===t||(t.length>=4&&x.length>=4&&(x.startsWith(t)||t.startsWith(x))))).length;
    const syn=extra.length&&extra.some(t=>ot.includes(t))?0.5:0;
    return {o,score:Math.max(hit/it.length,syn)};
  }).filter(m=>m.score>=0.5).sort((a,b)=>b.score-a.score);
}
function pct(o){
  const d=norm(o.deal);
  if(/1\s*\+\s*1/.test(d))return 50; if(/2\s*\+\s*1/.test(d))return 33; if(/2e halve/.test(d))return 25;
  const m=d.match(/(\d+)\s*%/); if(m)return +m[1];
  if(o.unitPrice&&o.was)return Math.round((1-o.unitPrice/o.was)*100);
  return 0;
}
function advise(name){
  const m=matchOffers(name);
  const j=m.find(x=>x.o.store==='jumbo'), p=m.find(x=>x.o.store==='plus');
  const pr=S.prices[slug(name)];
  if(j&&!p) return {store:'jumbo',offer:j.o,why:j.o.deal};
  if(p&&!j) return {store:'plus',offer:p.o,why:p.o.deal};
  if(j&&p){
    let w;
    if(j.o.unitPrice&&p.o.unitPrice&&j.o.unitPrice!==p.o.unitPrice) w=j.o.unitPrice<p.o.unitPrice?j:p;
    else w=pct(j.o)>=pct(p.o)?j:p;
    const other=w===j?p:j;
    return {store:w.o.store,offer:w.o,why:w.o.deal+' (ook bij '+(other.o.store==='jumbo'?'Jumbo':'Plus')+': '+other.o.deal+')'};
  }
  if(pr&&pr.jumbo&&pr.plus&&pr.jumbo!==pr.plus){
    const s=pr.jumbo<pr.plus?'jumbo':'plus';
    return {store:s,why:'Vorige keer goedkoper: '+eur(Math.min(pr.jumbo,pr.plus))};
  }
  if(pr&&(pr.jumbo||pr.plus)&&!(pr.jumbo&&pr.plus)) return {store:null,why:'Laatst betaald '+eur(pr.jumbo||pr.plus)+' bij '+(pr.jumbo?'Jumbo':'Plus')};
  return {store:null,why:'Geen aanbieding deze week'};
}
const storeOf=it=>ADV()?(it.store||advise(it.name).store||'any'):'any';
const SN={jumbo:'Jumbo',plus:'Plus',any:'Maakt niet uit'};

/* ---------- suggestions ---------- */
function historyNames(){const c={};S.trips.forEach(t=>(t.items||[]).forEach(i=>{const k=i.name.trim();c[k]=(c[k]||0)+1}));return c;}
function suggest(q){
  const nq=norm(q).trim(); if(nq.length<2) return [];
  const seen=new Set(), out=[];
  const push=(name,src,store)=>{const k=norm(name);if(seen.has(k))return;seen.add(k);out.push({name,src,store});};
  const hist=historyNames();
  Object.keys(hist).sort((a,b)=>hist[b]-hist[a]).filter(n=>norm(n).includes(nq)).forEach(n=>push(n,hist[n]+'× eerder'));
  S.offers.filter(activeOffer).filter(o=>norm(o.name+' '+(o.keywords||[]).join(' ')).includes(nq)).forEach(o=>push(o.name,(o.store==='jumbo'?'Jumbo':'Plus')+' · '+o.deal,o.store));
  STAPLES.filter(n=>norm(n).includes(nq)).forEach(n=>push(n,''));
  return out.slice(0,7);
}
function renderSugg(){
  const box=$('sugg'); const q=$('addInput').value;
  if(!q.trim()){
    S.sugs=[];
    if(document.activeElement!==$('addInput')){box.hidden=true;return;}
    const hist=historyNames(); const onList=new Set(S.list.filter(x=>!x.done).map(x=>norm(x.name)));
    const freq=Object.keys(hist).filter(n=>!onList.has(norm(n))).sort((a,b)=>hist[b]-hist[a]).slice(0,10);
    const tq=sortedTemplates();
    if(!freq.length&&!tq.length){box.hidden=true;return;}
    box.innerHTML=(tq.length?`<div class="sec">Vaste lijsten</div><div class="chips2">${tq.map(t=>`<button type="button" class="tplq" data-act="tpl-apply" data-id="${t.id}">+ ${esc(t.name)}</button>`).join('')}</div>`:'')+
      (freq.length?`<div class="sec">Vaak gehaald</div><div class="chips2">${freq.map(n=>`<button type="button" data-q="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>`:'');
    box.hidden=false; return;
  }
  S.sugs=suggest(q.replace(/^\d+\s*x?\s*/i,''));
  if(!S.sugs.length){box.hidden=true;return;}
  box.innerHTML=S.sugs.map((s,i)=>`<button type="button" data-i="${i}" class="${i===S.sugIdx?'on':''}"><span>${esc(s.name)}</span><span class="src">${esc(s.src)}</span></button>`).join('');
  box.hidden=false;
}
function parseEntry(v){const m=v.trim().match(/^(\d+)\s*x?\s+(.+)$/i);return m?{qty:Math.min(+m[1],99),name:m[2].trim()}:{qty:1,name:v.trim()};}
async function addItem(name,qty=1,st=null){
  name=name.trim(); if(!name) return;
  const ex=S.list.find(x=>!x.done&&norm(x.name)===norm(name));
  if(ex){await safe(store.upd('list',ex.id,{qty:(ex.qty||1)+qty}));return;}
  const d={name:name.charAt(0).toUpperCase()+name.slice(1),qty,done:false,addedAt:Date.now()}; if(st)d.store=st;
  if(ME)d.addedBy=ME;
  if(S.cur!=='main')d.listId=S.cur;
  await safe(store.add('list',d));
}

/* ---------- render ---------- */
function render(){
  if(!allLists().some(l=>l.id===S.cur))S.cur='main';
  S.list=S.items.filter(i=>listOf(i)===S.cur);
  document.querySelectorAll('nav.tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===S.tab));
  ['lijst','vaste','aanbiedingen','geschiedenis'].forEach(t=>$('v-'+t).hidden=S.tab!==t);
  $('cntTpl').textContent=S.templates.length||'';
  if(S.tab==='vaste')renderTemplates();
  const open=S.list.filter(x=>!x.done).length;
  $('cntList').textContent=S.list.length?open:'';
  const act=S.offers.filter(activeOffer).length; $('cntOffers').textContent=act||'';
  $('cntTrips').textContent=S.trips.length||'';
  if(S.meta){$('offerStamp').textContent='Aanbiedingen bijgewerkt '+fmtDate(S.meta.updatedAt)+(S.meta.week?' · '+S.meta.week:'');}
  $('menuBtn').hidden=S.tab!=='lijst'||!!S.shop;
  if(S.tab==='lijst')renderList(); if(S.tab==='aanbiedingen')renderOffers(); if(S.tab==='geschiedenis')renderHist();
}
function fmtDate(d){if(!d)return'';const x=new Date(d);return x.toLocaleDateString('nl-NL',{weekday:'short',day:'numeric',month:'short'});}

function renderList(){
  renderListsBar(); renderRecipe(); if(S.sheet) renderSheet(); if(S.shop) $('shopTitle').textContent=curList().name;
  // quick add: frequent items not on list
  const hist=historyNames(); const onList=new Set(S.list.filter(x=>!x.done).map(x=>norm(x.name)));
  const freq=Object.keys(hist).filter(n=>!onList.has(norm(n))).sort((a,b)=>hist[b]-hist[a]).slice(0,8);
  const tq=sortedTemplates().map(t=>`<button type="button" class="tplq" data-act="tpl-apply" data-id="${t.id}">+ ${esc(t.name)} (${(t.items||[]).length})</button>`).join('');
  $('menuBtn').hidden=S.tab!=='lijst';
  if(!S.list.length){
    $('planBox').innerHTML=''; $('finishBox').innerHTML='';
    $('listBox').innerHTML=`<div class="empty"><strong>${esc(curList().name)} is leeg</strong>Typ onderaan wat je nodig hebt. Tik in het vak voor je vaste lijsten en wat je vaak haalt.${ADV()?' De app kijkt meteen of iets bij Jumbo of Plus in de aanbieding is.':''}</div>`;
    return;
  }
  const open=S.list.filter(x=>!x.done);
  const cnt={jumbo:0,plus:0,any:0}; open.forEach(i=>cnt[storeOf(i)]++);
  let adv;
  if(cnt.jumbo&&cnt.plus) adv=`Ga langs <strong>beide winkels</strong>. Wat niet uitmaakt pak je mee waar je al bent.`;
  else if(cnt.jumbo) adv=`Alles kan in één keer bij <strong>Jumbo</strong>.`;
  else if(cnt.plus) adv=`Alles kan in één keer bij <strong>Plus</strong>.`;
  else adv=open.length?`Geen aanbiedingen op je lijst. Haal het waar het jou uitkomt.`:'Alles is afgevinkt.';
  const parts=[cnt.jumbo?`<b>${cnt.jumbo}</b> bij Jumbo`:'',cnt.plus?`<b>${cnt.plus}</b> bij Plus`:'',cnt.any?`<b>${cnt.any}</b> maakt niet uit`:''].filter(Boolean).join(' · ');
  if(!ADV()||!open.length) $('planBox').innerHTML=''; else $('planBox').innerHTML=`<p class="advice" style="margin:0">${parts}<br>${adv}</p>`;
  const groups=ADV()?['jumbo','plus','any'].map(s=>({s,items:S.list.filter(i=>storeOf(i)===s).sort(cmpItems)})).filter(g=>g.items.length)
    :[{s:null,items:[...S.list].sort(cmpItems)}];
  $('listBox').innerHTML=groups.map(g=>`<div class="group">${g.s?`<h2><span class="dot ${g.s}"></span>${SN[g.s]}</h2>`:''}<ul class="items">${itemsHTML(g.items)}</ul></div>`).join('')+
   `${S.list.some(x=>x.done)&&!S.finishing?`<div class="bar" style="margin-top:12px;justify-content:center"><button class="btn" data-act="finish">Boodschappen afronden (${S.list.filter(x=>x.done).length})</button></div>`:''}<p class="hint" style="margin-top:12px">Veeg naar rechts om af te vinken, naar links om te verwijderen. Tik op een product voor aantal en winkel.</p>`;
  renderFinish();
}
function itemHTML(i){
  const adv=ADV(); const a=adv?advise(i.name):{why:''}; const s=storeOf(i);
  const op=S.exp===i.id&&!S.shop;
  const chip=adv&&op?`<button class="tag ${s}" data-act="store" data-id="${i.id}" title="Tik om winkel te wisselen">${SN[s]} ✎</button>`:'';
  return `<li class="${i.done?'done':''}${op?' open':''}" data-row="${i.id}"><button class="chk" data-act="toggle" data-id="${i.id}" aria-label="${i.done?'Niet afgevinkt':'Afvinken'}: ${esc(i.name)}">${i.done?'✓':''}</button>
  <div style="min-width:0"><div class="nm">${esc(i.name)}</div><div class="why">${chip}<span>${esc(a.why==='Geen aanbieding deze week'&&!op?'':a.why)}${a.offer&&a.offer.price&&/^vanaf/.test(a.offer.price)?' · '+esc(a.offer.price):''}${i.addedBy&&ME&&i.addedBy!==ME?(adv?' · ':'')+'door '+esc(whoName(i.addedBy)):''}</span></div></div>
  ${op?`<div class="ctl"><button data-act="minus" data-id="${i.id}" aria-label="Minder">−</button><span class="qty">${i.qty||1}</span><button data-act="plus" data-id="${i.id}" aria-label="Meer">+</button></div>`:(i.qty>1?`<span class="qty">×${i.qty}</span>`:'<span></span>')}</li>`;
}
function renderFinish(){
  const box=$('finishBox'); if(!S.finishing){box.innerHTML='';return;}
  const done=S.list.filter(x=>x.done);
  if(!done.length){S.finishing=false;box.innerHTML='';return;}
  box.innerHTML=`<div class="sheet"><h3 class="h2">Afronden</h3><p class="sub" style="margin:0">Vul gerust in wat je betaald hebt (per stuk). Dan weet de app de volgende keer waar iets goedkoper is.</p>
  ${done.map(i=>{const s=storeOf(i);const pr=S.prices[slug(i.name)]||{};const pv=s!=='any'&&pr[s]?String(pr[s]).replace('.',','):'';return `<div class="row"><span class="nm">${esc(i.name)} <span class="qty">×${i.qty||1}</span></span><button class="tag ${s}" data-act="store" data-id="${i.id}">${SN[s]}</button><input id="pr-${i.id}" inputmode="decimal" placeholder="€" value="${pv}" aria-label="Prijs per stuk ${esc(i.name)}"></div>`}).join('')}
  <div class="bar"><button class="btn ghost small" data-act="finish-cancel">Annuleer</button><button class="btn" data-act="finish-save">Bewaar in geschiedenis</button></div></div>`;
}

function renderOffers(){
  document.querySelectorAll('#storeSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.s===S.store));
  const q=norm(S.oq);
  let arr=S.offers.filter(activeOffer).filter(o=>S.store==='all'||o.store===S.store).filter(o=>!q||norm(o.name+' '+o.deal+' '+(o.category||'')+' '+(o.keywords||[]).join(' ')).includes(q));
  if(!S.offers.length){$('offerBox').innerHTML=`<div class="empty"><strong>Nog geen aanbiedingen geladen</strong>${LOCAL?'De gedeelde opslag is in deze weergave niet beschikbaar.':'De aanbiedingen worden elke woensdag ververst.'}</div>`;return;}
  if(!arr.length){$('offerBox').innerHTML=`<div class="empty"><strong>Niets gevonden</strong>${S.offers.filter(activeOffer).length?'Probeer een ander woord.':'De aanbiedingen van deze week zijn verlopen; de nieuwe komen op woensdag.'}</div>`;return;}
  const cats={}; arr.forEach(o=>{(cats[o.category||'Overig']=cats[o.category||'Overig']||[]).push(o)});
  const onList=new Set(S.list.map(x=>norm(x.name)));
  $('offerBox').innerHTML=Object.keys(cats).map(c=>`<div class="cat">${esc(c)}</div><div class="offers" style="margin-top:8px">${cats[c].map(o=>`
   <div class="offer"><span class="tag ${o.store}" style="align-self:flex-start">${o.store==='jumbo'?'Jumbo':'Plus'}</span>
   <div class="deal">${esc(o.deal)}${o.price&&!/voor/.test(o.deal)?'':''}</div><div class="on">${esc(o.name)}</div>
   <div class="meta"><small>${o.was?`<span class="was">${eur(o.was)}</span> `:''}t/m ${esc(fmtDate(o.validTo))}</small>
   ${onList.has(norm(o.name))?`<small>Op lijst ✓</small>`:`<button class="btn small" data-act="addoffer" data-id="${esc(o.id)}">+ Lijst</button>`}</div></div>`).join('')}</div>`).join('');
}

function spendHTML(){
  const months={};
  S.trips.forEach(t=>{const k=(t.date||'').slice(0,7);if(!k)return;const m=months[k]=months[k]||{jumbo:0,plus:0,any:0,sav:0};
    (t.items||[]).forEach(i=>{if(!i.price)return;const q=i.qty||1;m[i.store==='jumbo'||i.store==='plus'?i.store:'any']+=i.price*q;if(i.was&&i.was>i.price)m.sav+=(i.was-i.price)*q;});});
  const keys=Object.keys(months).sort().reverse().slice(0,6).filter(k=>{const m=months[k];return m.jumbo+m.plus+m.any>0;});
  if(!keys.length) return `<div><h3 class="h2" style="margin-bottom:6px">Uitgaven per maand</h3><p class="sub" style="margin:0">Vul bij "Boodschappen afronden" in wat je betaald hebt. Dan zie je hier per maand wat je bij Jumbo en Plus uitgeeft en hoeveel je met aanbiedingen bespaart.</p></div>`;
  const max=Math.max(...keys.map(k=>months[k].jumbo+months[k].plus+months[k].any));
  const rows=keys.map(k=>{const m=months[k],t=m.jumbo+m.plus+m.any,w=x=>(x/max*100).toFixed(1)+'%';
    const lbl=new Date(k+'-01T12:00').toLocaleDateString('nl-NL',{month:'short',year:'2-digit'});
    return `<div class="m"><span>${lbl}</span><div class="bar2" title="Jumbo ${eur(m.jumbo)} · Plus ${eur(m.plus)} · overig ${eur(m.any)}"><i class="bj" style="width:${w(m.jumbo)}"></i><i class="bp" style="width:${w(m.plus)}"></i><i class="ba" style="width:${w(m.any)}"></i></div><span class="amt">${eur(t)}${m.sav>0.005?`<br><span class="sav">−${eur(m.sav)} bespaard</span>`:''}</span></div>`;}).join('');
  return `<div><h3 class="h2" style="margin-bottom:8px">Uitgaven per maand</h3><div class="spend">${rows}</div><div class="legend" style="margin-top:8px"><span><span class="dot jumbo"></span>Jumbo</span><span><span class="dot plus"></span>Plus</span><span><span class="dot any"></span>Overig</span><span>Besparing is geschat op basis van de van-prijs.</span></div></div>`;
}
function renderHist(){
  if(!S.trips.length){$('histBox').innerHTML=`<div class="empty"><strong>Nog geen boodschappen bewaard</strong>Vink op je lijst af wat je gehaald hebt en kies "Boodschappen afronden". Hier zie je daarna elke ronde terug.</div>`;return;}
  const hist=historyNames(); const top=Object.keys(hist).sort((a,b)=>hist[b]-hist[a]).slice(0,14);
  const trips=[...S.trips].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  $('histBox').innerHTML=spendHTML()+`<div><h3 class="h2" style="margin-bottom:8px">Vaak gehaald</h3><div class="freq">${top.map(n=>`<button data-q="${esc(n)}">${esc(n)}<b>${hist[n]}×</b></button>`).join('')}</div></div>
  <h3 class="h2">Eerdere rondes</h3><div class="receipts">${trips.map(receiptHTML).join('')}</div>`;
}
function receiptHTML(t){
  const by={}; (t.items||[]).forEach(i=>{(by[i.store||'any']=by[i.store||'any']||[]).push(i)});
  let total=0;
  const body=Object.keys(by).map(s=>{let st=0;const rows=by[s].map(i=>{const line=i.price?i.price*(i.qty||1):null;if(line)st+=line;return `<div class="r"><span>${i.qty>1?i.qty+'× ':''}${esc(i.name)}</span><span>${line?eur(line):''}</span></div>`}).join('');total+=st;
    return `<div style="margin-top:8px;font-weight:600">${SN[s].toUpperCase()}</div>${rows}${st?`<div class="r tot"><span>subtotaal</span><span>${eur(st)}</span></div>`:''}`}).join('');
  const d=new Date(t.date);
  return `<div class="receipt"><h3><span>${d.toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'})}${t.listName?' · '+esc(t.listName):''}</span><span>${(t.items||[]).length} art.</span></h3>${body}<hr>
   <div class="r tot"><span>TOTAAL</span><span>${total?eur(total):'—'}</span></div>
   <div class="act" style="flex-wrap:wrap"><button class="btn small" data-act="redo" data-id="${t.id}">Zet terug op lijst</button><button class="btn small ghost" data-act="trip-tpl" data-id="${t.id}">Als vaste lijst</button>${S.delTrip===t.id?`<button class="btn small ghost" data-act="deltrip-yes" data-id="${t.id}">Ja, verwijder</button>`:`<button class="btn small ghost" data-act="deltrip" data-id="${t.id}">Verwijder</button>`}</div></div>`;
}

/* ---------- vegen ---------- */
let sw=null, swipeJust=false;
document.addEventListener('pointerdown',e=>{const li=e.target.closest('#listBox li[data-row]');if(!li||e.button>0)return;sw={li,id:li.dataset.row,x:e.clientX,y:e.clientY,dx:0,on:false,pid:e.pointerId};});
document.addEventListener('pointermove',e=>{if(!sw||e.pointerId!==sw.pid)return;const dx=e.clientX-sw.x,dy=e.clientY-sw.y;
  if(!sw.on){if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.3){sw.on=true;try{sw.li.setPointerCapture(e.pointerId)}catch(_){}}else if(Math.abs(dy)>12){sw=null;return;}else return;}
  sw.dx=dx;sw.li.style.transform=`translateX(${Math.max(-140,Math.min(140,dx))}px)`;sw.li.classList.toggle('sw-r',dx>60);sw.li.classList.toggle('sw-l',dx<-60);});
function endSwipe(){if(!sw)return;const {li,id,dx,on}=sw;sw=null;li.style.transform='';li.classList.remove('sw-r','sw-l');if(!on)return;swipeJust=true;setTimeout(()=>swipeJust=false,350);
  const it=S.list.find(x=>x.id===id);if(!it)return;if(dx>80)safe(store.upd('list',id,{done:!it.done}));else if(dx<-80)removeItem(it);}
document.addEventListener('pointerup',endSwipe);document.addEventListener('pointercancel',endSwipe);

/* ---------- winkelmodus ---------- */
let wakeLock=null;
async function setShop(on){
  S.shop=on; document.body.classList.toggle('shop',on);
  $('shopTitle').textContent=on?curList().name:'Winkelmodus';
  if(on){S.tab='lijst';try{wakeLock=await navigator.wakeLock.request('screen');}catch(_){}}
  else{try{wakeLock&&wakeLock.release();}catch(_){}wakeLock=null;}
  render(); window.scrollTo(0,0);
}

/* ---------- recept naar lijst ---------- */
let sampleFn=null, recipeCtl=null;
const R_={open:false,busy:false,items:null,err:''};
function renderRecipe(){
  const box=$('recipeBox'); if(!box) return;
  if(!R_.open||!sampleFn){box.innerHTML='';return;}
  let body='';
  if(R_.busy) body=`<p class="sub" style="margin:0">Claude zoekt de ingrediënten op… <button type="button" class="btn small ghost" data-act="recipe-stop">Stop</button></p>`;
  else if(R_.items){
    body=`<div class="ing">${R_.items.map((x,ix)=>`<label><input type="checkbox" id="ing-${ix}" ${x.basis?'':'checked'}><span><b>${esc(x.name)}</b>${x.qty>1?' ×'+x.qty:''}${x.amount?` <small>${esc(x.amount)}</small>`:''}${x.basis?' <small>· heb je waarschijnlijk al</small>':''}</span>${x.offer?`<span class="tag ${x.offer.store}">${x.offer.store==='jumbo'?'Jumbo':'Plus'}</span>`:'<span></span>'}</label>`).join('')}</div>
    <div class="row2"><button type="button" class="btn" data-act="recipe-add">Zet aangevinkte op ${esc(curList().name)}</button><button type="button" class="btn ghost" data-act="recipe-close">Sluiten</button></div>`;
  }
  box.innerHTML=`<div class="recipe"><form class="row2" id="recipeForm"><input type="text" id="recipeQ" placeholder="Wat ga je koken? bv. lasagne" aria-label="Gerecht" value="${esc(R_.q||'')}"><input type="number" id="recipeP" min="1" max="20" value="${R_.p||4}" aria-label="Aantal personen"><button class="btn" type="submit" ${R_.busy?'disabled':''}>Ingrediënten</button></form>${R_.err?`<p class="sub" style="margin:0;color:var(--warn)">${esc(R_.err)}</p>`:''}${body}</div>`;
}
async function askRecipe(){
  const q=$('recipeQ').value.trim(), p=Math.max(1,Math.min(20,parseInt($('recipeP').value)||4)); if(!q){$('recipeQ').focus();return;}
  R_.q=q;R_.p=p;R_.busy=true;R_.items=null;R_.err='';renderRecipe();
  const offers=S.offers.filter(activeOffer).slice(0,180).map(o=>`${o.store==='jumbo'?'J':'P'}: ${o.name} (${o.deal})`).join('\n');
  const prompt=`Je helpt met een Nederlandse boodschappenlijst. Gerecht: "${q}" voor ${p} personen.
Geef de ingrediënten die je in een Nederlandse supermarkt koopt. Gebruik korte, gangbare Nederlandse productnamen zoals op een boodschappenlijstje (bv. "Gehakt", "Lasagnebladen", "Tomatenblokjes", "Geraspte kaas"), geen merknamen.
Zet "basis": true bij dingen die de meeste mensen al in huis hebben (zout, peper, olie, boter, suiker, bloem, gedroogde kruiden).
"qty" is het aantal verpakkingen dat je koopt (meestal 1), "amount" de benodigde hoeveelheid als korte tekst (bv. "500 g").
Antwoord met alleen een JSON-array, bijvoorbeeld: [{"name":"Gehakt","qty":1,"amount":"500 g","basis":false}]
Ter info, aanbiedingen deze week (gebruik ze alleen om de productnaam herkenbaar te houden, verzin geen producten):
${offers}`;
  recipeCtl=new AbortController();
  try{
    const arr=await sampleFn.json(prompt,{modelTier:'quick',signal:recipeCtl.signal});
    const items=(Array.isArray(arr)?arr:[]).filter(x=>x&&typeof x.name==='string'&&x.name.trim()).slice(0,30).map(x=>({name:String(x.name).trim().slice(0,60),qty:Math.max(1,Math.min(20,parseInt(x.qty)||1)),amount:x.amount?String(x.amount).slice(0,30):'',basis:!!x.basis}));
    items.forEach(x=>{const a=advise(x.name);if(a.offer)x.offer=a.offer;});
    if(!items.length) R_.err='Er kwamen geen ingrediënten terug. Probeer een andere omschrijving.';
    R_.items=items.length?items:null;
  }catch(e){
    const c=e&&e.code;
    if(c==='not_granted'||c==='sampling_disabled'||c==='not_declared'||c==='capability_disabled'||c==='capability_removed'){sampleFn=null;R_.open=false;}
    else if(c!=='cancelled') R_.err=c==='rate_limited'?'Even te veel vragen achter elkaar. Probeer het zo opnieuw.':c==='invalid_json'||c==='empty_completion'?'Het antwoord was niet bruikbaar. Probeer het nog eens.':'Het ophalen lukte niet. Probeer het nog eens.';
  }finally{R_.busy=false;renderRecipe();}
}
document.addEventListener('submit',e=>{if(e.target.id==='recipeForm'){e.preventDefault();askRecipe();}});

/* ---------- meerdere lijsten ---------- */
function renderListsBar(){
  const L=allLists(), c=curList();
  const chips=L.map(l=>{const n=S.items.filter(i=>listOf(i)===l.id&&!i.done).length;return `<button type="button" data-act="list-pick" data-id="${l.id}" aria-pressed="${l.id===c.id}">${esc(l.name)}${n?`<span class="c">${n}</span>`:''}</button>`}).join('')+`<button type="button" class="new" data-act="list-new">+ Nieuwe lijst</button>`;
  let extra;
  if(S.newList) extra=`<form class="tplsave" id="listNewForm"><input id="listNewName" placeholder="Naam, bv. Duitsland" aria-label="Naam nieuwe lijst"><label class="chk2"><input type="checkbox" id="listNewAdv"> Jumbo/Plus-advies</label><button class="btn" type="submit">Maak lijst</button><button class="btn ghost" type="button" data-act="list-new-no">Annuleer</button></form>`;
  else if(S.listRen) extra=`<form class="tplsave" id="listRenForm"><input id="listRenName" value="${esc(c.name)}" aria-label="Nieuwe naam voor ${esc(c.name)}"><button class="btn" type="submit">Opslaan</button><button class="btn ghost" type="button" data-act="list-ren-no">Annuleer</button></form>`;
  else extra='';  const _old=`<div class="listmeta"><button type="button" data-act="list-ren">Naam wijzigen</button><span>·</span><button type="button" data-act="list-adv">Jumbo/Plus-advies: ${c.advice?'aan':'uit'}</button>${c.id==='main'?'':S.listDel?`<span>·</span><span>Lijst met alle producten verwijderen?</span><button type="button" class="danger" data-act="list-del-yes">Ja, verwijder</button><button type="button" data-act="list-del-no">Nee</button>`:`<span>·</span><button type="button" data-act="list-del">Verwijder lijst</button>`}</div>`;
  $('listsBar').innerHTML=`<div class="lists" role="group" aria-label="Lijsten">${chips}</div>${extra}`;
}
function pickList(id){S.cur=id;S.listRen=false;S.listDel=false;S.newList=false;S.finishing=false;S.confirmClear=false;try{localStorage.setItem('bs-cur',id)}catch(_){}render();}
async function saveListMeta(id,data){
  if(id==='main'){const c=curList();await safe(store.put('lists','main',{name:c.name,advice:c.advice,...data}));}
  else await safe(store.upd('lists',id,data));
}
document.addEventListener('submit',async e=>{
  const f=e.target;
  if(f.id==='listNewForm'){e.preventDefault();const n=$('listNewName').value.trim();if(!n){$('listNewName').focus();return;}
    const id='l'+uid(); S.newList=false;
    await safe(store.put('lists',id,{name:n,advice:$('listNewAdv').checked,createdAt:Date.now()}));
    pickList(id); setTimeout(()=>$('addInput').focus(),0);}
  if(f.id==='listRenForm'){e.preventDefault();const n=$('listRenName').value.trim();if(!n){$('listRenName').focus();return;}
    S.listRen=false; await saveListMeta(curList().id,{name:n}); render();}
});

/* ---------- vaste lijsten ---------- */
const sortedTemplates=()=>[...S.templates].sort((a,b)=>String(a.name).localeCompare(String(b.name),'nl'));
const tplItems=items=>{const m=new Map();(items||[]).forEach(i=>{const k=norm(i.name);if(!k)return;const e=m.get(k);if(e)e.qty+=(i.qty||1);else m.set(k,{name:i.name,qty:i.qty||1});});return [...m.values()];};
function renderTemplates(){
  const trip=S.tplFromTrip&&S.trips.find(t=>t.id===S.tplFromTrip);
  const src=trip?trip.items:S.list;
  let form;
  if(trip) form=`<form class="tplsave" id="tplSave"><input id="tplName" placeholder="Naam, bv. Verjaardag" aria-label="Naam vaste lijst"><button class="btn" type="submit">Bewaar ronde van ${esc(fmtDate(trip.date))} (${tplItems(src).length})</button><button class="btn ghost" type="button" data-act="tpl-cancel">Annuleer</button></form>`;
  else if(S.list.length) form=`<form class="tplsave" id="tplSave"><input id="tplName" placeholder="Naam, bv. Verjaardag" aria-label="Naam vaste lijst"><button class="btn" type="submit">Bewaar huidige lijst (${tplItems(src).length})</button><button class="btn ghost" type="button" data-act="tpl-empty">Lege lijst maken</button></form>`;
  else form=`<form class="tplsave" id="tplSave"><input id="tplName" placeholder="Naam, bv. Verjaardag" aria-label="Naam vaste lijst"><button class="btn" type="submit">Maak vaste lijst</button></form><p class="sub" style="margin:8px 0 0">Daarna voeg je er producten aan toe in het vak onder de lijst.</p>`;
  const head=`<div><h3 class="h2" style="margin-bottom:8px">Nieuwe vaste lijst</h3>${form}</div>`;
  if(!S.templates.length){$('tplBox').innerHTML=head+`<div class="empty" style="margin-top:18px"><strong>Nog geen vaste lijsten</strong>Bewaar bijvoorbeeld alles voor een verjaardag of het weekend. Daarna zet je die met één tik op je boodschappenlijst.</div>`;return;}
  $('tplBox').innerHTML=head+`<div class="tpls" style="margin-top:18px">${sortedTemplates().map(t=>`
   <div class="tpl">${S.tplRen===t.id?`<form class="tplsave tplren" data-id="${t.id}"><input id="tplren-${t.id}" value="${esc(t.name)}" aria-label="Nieuwe naam"><button class="btn small" type="submit">Opslaan</button><button class="btn small ghost" type="button" data-act="tpl-ren-no">Annuleer</button></form>`:`<div class="hd"><b data-act="tpl-ren" data-id="${t.id}" style="cursor:pointer" title="Tik om de naam te wijzigen">${esc(t.name)} <span style="font-size:14px;color:var(--muted)">✎</span></b><span class="sub">${(t.items||[]).length} producten · <button class="btn small ghost" style="padding:3px 9px" data-act="tpl-ren" data-id="${t.id}">Naam wijzigen</button></span></div>`}
   <div class="chips">${(t.items||[]).map((i,ix)=>`<span class="chip">${esc(i.name)}${i.qty>1?` <span class="q">×${i.qty}</span>`:''}<button data-act="tpl-rm" data-id="${t.id}" data-i="${ix}" aria-label="Haal ${esc(i.name)} uit ${esc(t.name)}">×</button></span>`).join('')||'<span class="sub">Leeg</span>'}</div>
   <form class="tpladd" data-id="${t.id}"><input id="tpladd-${t.id}" placeholder="Product toevoegen aan ${esc(t.name)}" aria-label="Product toevoegen aan ${esc(t.name)}"><button class="btn small ghost" type="submit">Voeg toe</button></form>
   <div class="acts"><button class="btn small" data-act="tpl-apply" data-id="${t.id}">Zet op boodschappenlijst</button>
   ${S.list.length?(S.tplOver===t.id?`<button class="btn small ghost" data-act="tpl-over-yes" data-id="${t.id}">Ja, vervang door huidige lijst</button>`:`<button class="btn small ghost" data-act="tpl-over" data-id="${t.id}">Vervang door huidige lijst</button>`):''}
   ${S.tplDel===t.id?`<button class="btn small ghost" data-act="tpl-del-yes" data-id="${t.id}">Ja, verwijder</button>`:`<button class="btn small ghost" data-act="tpl-del" data-id="${t.id}">Verwijder</button>`}</div></div>`).join('')}</div>`;
}
document.addEventListener('submit',async e=>{
  const f=e.target;
  if(f.id==='tplSave'){e.preventDefault();const name=$('tplName').value.trim();if(!name){$('tplName').focus();return;}
    const trip=S.tplFromTrip&&S.trips.find(t=>t.id===S.tplFromTrip);
    const items=tplItems(trip?trip.items:S.list);
    const ex=S.templates.find(t=>norm(t.name)===norm(name));
    S.tplFromTrip=null;
    if(ex) await safe(store.upd('templates',ex.id,{items,updatedAt:Date.now()}));
    else await safe(store.add('templates',{name,items,createdAt:Date.now()}));
    renderTemplates();}
  if(f.classList.contains('tplren')){e.preventDefault();const id=f.dataset.id;const v=$('tplren-'+id).value.trim();if(!v){$('tplren-'+id).focus();return;}S.tplRen=null;await safe(store.upd('templates',id,{name:v}));renderTemplates();return;}
  if(f.classList.contains('tpladd')){e.preventDefault();const t=S.templates.find(x=>x.id===f.dataset.id);const inp=$('tpladd-'+f.dataset.id);
    const {qty,name}=parseEntry(inp.value);if(!t||!name)return;
    const items=tplItems([...(t.items||[]),{name:name.charAt(0).toUpperCase()+name.slice(1),qty}]);
    await safe(store.upd('templates',t.id,{items}));}
});

/* ---------- events ---------- */
document.querySelector('nav.tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;S.tab=b.dataset.tab;window.scrollTo(0,0);try{localStorage.setItem('bs-tab',S.tab)}catch(_){}render();});
$('addInput').addEventListener('input',()=>{S.sugIdx=-1;renderSugg();});
$('addInput').addEventListener('focus',()=>{S.sugIdx=-1;renderSugg();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.sheet)closeSheet();});
$('addInput').addEventListener('keydown',e=>{
  if($('sugg').hidden)return;
  if(e.key==='ArrowDown'){e.preventDefault();S.sugIdx=Math.min(S.sugIdx+1,S.sugs.length-1);renderSugg();}
  else if(e.key==='ArrowUp'){e.preventDefault();S.sugIdx=Math.max(S.sugIdx-1,-1);renderSugg();}
  else if(e.key==='Escape'){$('sugg').hidden=true;}
});
$('addInput').addEventListener('blur',()=>setTimeout(()=>$('sugg').hidden=true,150));
$('addForm').addEventListener('submit',e=>{e.preventDefault();const v=$('addInput').value;let {qty,name}=parseEntry(v);
  let st=null; if(S.sugIdx>=0&&S.sugs[S.sugIdx]){name=S.sugs[S.sugIdx].name;st=S.sugs[S.sugIdx].store||null;}
  if(!name)return; addItem(name,qty,st); $('addInput').value='';S.sugIdx=-1;$('sugg').hidden=true;});
$('sugg').addEventListener('mousedown',e=>{const b=e.target.closest('button');if(!b)return;e.preventDefault();if(b.dataset.i==null)return;const s=S.sugs[+b.dataset.i];const {qty}=parseEntry($('addInput').value);addItem(s.name,qty,s.store||null);$('addInput').value='';$('sugg').hidden=true;});
$('storeSeg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;S.store=b.dataset.s;renderOffers();});
$('offerSearch').addEventListener('input',e=>{S.oq=e.target.value;renderOffers();});

document.addEventListener('click',async e=>{
  const q=e.target.closest('[data-q]'); if(q){addItem(q.dataset.q);return;}
  if(swipeJust){swipeJust=false;return;}
  if(!e.target.closest('[data-act]')){const row=e.target.closest('li[data-row]');if(row){const it=S.list.find(x=>x.id===row.dataset.row);if(!it)return;
    if(S.shop) safe(store.upd('list',it.id,{done:!it.done})); else {S.exp=S.exp===it.id?null:it.id;renderList();} return;}}
  const b=e.target.closest('[data-act]'); if(!b)return;
  const id=b.dataset.id, it=S.list.find(x=>x.id===id), act=b.dataset.act;
  if(act==='toggle'&&it) safe(store.upd('list',id,{done:!it.done}));
  if(act==='plus'&&it) safe(store.upd('list',id,{qty:(it.qty||1)+1}));
  if(act==='minus'&&it){ if((it.qty||1)<=1) removeItem(it); else safe(store.upd('list',id,{qty:it.qty-1})); }
  if(act==='store'&&it){const order=['jumbo','plus','any'];const cur=storeOf(it);const nx=order[(order.indexOf(cur)+1)%3];safe(store.upd('list',id,{store:nx}));}
  if(act==='clear'){S.confirmClear=true;renderList();}
  if(act==='clear-no'){S.confirmClear=false;renderList();}
  if(act==='clear-yes'){S.confirmClear=false;closeSheet();for(const x of [...S.list])await safe(store.del('list',x.id));}
  if(act==='finish'){S.finishing=true;renderList();}
  if(act==='finish-cancel'){S.finishing=false;renderList();}
  if(act==='finish-save'){
    const done=S.list.filter(x=>x.done);
    const items=done.map(i=>{const v=parseFloat(($('pr-'+i.id)?.value||'').replace(',','.'));const s=storeOf(i);const o=s!=='any'?(matchOffers(i.name).find(m=>m.o.store===s)||{}).o:null;return {name:i.name,qty:i.qty||1,store:s,...(isNaN(v)?{}:{price:v}),...(o&&o.was&&!isNaN(v)&&o.was>v?{was:o.was}:{})};});
    S.finishing=false;
    const tr={date:new Date().toISOString(),items}; if(S.cur!=='main')tr.listName=curList().name;
    await safe(store.add('trips',tr));
    for(const i of items){ if(i.price&&i.store!=='any') await safe(store.price(slug(i.name),{name:i.name,[i.store]:i.price,updatedAt:today()})); }
    for(const i of done) await safe(store.del('list',i.id));
    S.tab='geschiedenis'; render();
  }
  if(act==='addoffer'){const o=S.offers.find(x=>x.id===id); if(o) addItem(o.name,1,o.store);}
  if(act==='redo'){const t=S.trips.find(x=>x.id===id); if(t) for(const i of t.items||[]) await addItem(i.name,i.qty||1);S.tab='lijst';render();}
  const tp=S.templates.find(x=>x.id===id);
  if(act==='tpl-apply'&&tp){for(const i of tp.items||[]) await addItem(i.name,i.qty||1);S.tab='lijst';render();note('');}
  if(act==='tpl-fromlist'){S.tplFromTrip=null;S.tab='vaste';render();setTimeout(()=>$('tplName')&&$('tplName').focus(),0);}
  if(act==='trip-tpl'){S.tplFromTrip=id;S.tab='vaste';render();setTimeout(()=>$('tplName')&&$('tplName').focus(),0);}
  if(act==='tpl-cancel'){S.tplFromTrip=null;renderTemplates();}
  if(act==='tpl-rm'&&tp){const items=(tp.items||[]).filter((_,ix)=>ix!==+b.dataset.i);safe(store.upd('templates',id,{items}));}
  if(act==='tpl-over'){S.tplOver=id;renderTemplates();}
  if(act==='tpl-over-yes'&&tp){S.tplOver=null;safe(store.upd('templates',id,{items:tplItems(S.list),updatedAt:Date.now()}));}
  if(act==='tpl-del'){S.tplDel=id;renderTemplates();}
  if(act==='tpl-ren'){S.tplRen=id;renderTemplates();setTimeout(()=>{const i=$('tplren-'+id);if(i){i.focus();i.select();}},0);}
  if(act==='tpl-ren-no'){S.tplRen=null;renderTemplates();}
  if(act==='tpl-empty'){const n=$('tplName').value.trim();if(!n){$('tplName').focus();return;}await safe(store.add('templates',{name:n,items:[],createdAt:Date.now()}));renderTemplates();}
  if(act==='tpl-del-yes'){S.tplDel=null;safe(store.del('templates',id));}
  if(act==='menu'){openSheet('menu');return;}
  if(act==='sheet-bg'){if(e.target===b)closeSheet();return;}
  if(act==='sheet-close'){closeSheet();return;}
  if(act==='m-shop'){closeSheet();setShop(true);return;}
  if(act==='m-recipe'){closeSheet();R_.open=true;renderRecipe();window.scrollTo(0,0);setTimeout(()=>$('recipeQ')&&$('recipeQ').focus(),0);return;}
  if(act==='m-finish'){closeSheet();S.finishing=true;renderList();setTimeout(()=>$('finishBox').scrollIntoView({behavior:'smooth'}),0);return;}
  if(act==='m-savetpl'){closeSheet();S.tplFromTrip=null;S.tab='vaste';render();setTimeout(()=>$('tplName')&&$('tplName').focus(),0);return;}
  if(act==='m-rename'){closeSheet();S.listRen=true;S.newList=false;renderList();window.scrollTo(0,0);setTimeout(()=>{const i=$('listRenName');if(i){i.focus();i.select();}},0);return;}
  if(act==='m-adv'){const c=curList();await saveListMeta(c.id,{advice:!c.advice});renderSheet();render();return;}
  if(act==='m-clear'){S.confirmClear=true;renderSheet();return;}
  if(act==='m-del'){S.listDel=true;renderSheet();return;}
  if(act==='m-home'){openSheet('home');return;}
  if(act==='m-push'){await togglePush();renderSheet();return;}
  if(act==='m-name'){openSheet('name');setTimeout(()=>{const i=$('nameInput');if(i){i.focus();i.select();}},0);return;}
  if(act==='m-logout'){closeSheet();await sb.auth.signOut();location.reload();return;}
  if(act==='rm'&&it){removeItem(it);return;}
  if(act==='shop-on'){setShop(true);return;}
  if(act==='shop-off'){setShop(false);return;}
  if(act==='recipe-open'){R_.open=!R_.open;renderRecipe();if(R_.open)setTimeout(()=>$('recipeQ')&&$('recipeQ').focus(),0);return;}
  if(act==='recipe-close'){R_.open=false;R_.items=null;R_.q='';renderRecipe();return;}
  if(act==='recipe-stop'){recipeCtl&&recipeCtl.abort();return;}
  if(act==='recipe-add'&&R_.items){const pick=R_.items.filter((x,ix)=>$('ing-'+ix)&&$('ing-'+ix).checked);for(const x of pick)await addItem(x.name,x.qty,x.offer?x.offer.store:null);R_.open=false;R_.items=null;R_.q='';renderRecipe();flash(pick.length+' ingrediënten op '+curList().name+' gezet');return;}
  if(act==='list-pick'){pickList(id);}
  if(act==='list-new'){S.newList=true;S.listRen=false;S.listDel=false;renderList();setTimeout(()=>$('listNewName')&&$('listNewName').focus(),0);}
  if(act==='list-new-no'){S.newList=false;renderList();}
  if(act==='list-ren'){S.listRen=true;S.newList=false;S.listDel=false;renderList();setTimeout(()=>{const i=$('listRenName');if(i){i.focus();i.select();}},0);}
  if(act==='list-ren-no'){S.listRen=false;renderList();}
  if(act==='list-adv'){const c=curList();await saveListMeta(c.id,{advice:!c.advice});render();}
  if(act==='list-del'){S.listDel=true;renderList();}
  if(act==='list-del-no'){S.listDel=false;renderList();}
  if(act==='list-del-yes'){const c=curList();if(c.id!=='main'){S.listDel=false;closeSheet();for(const x of S.items.filter(i=>listOf(i)===c.id))await safe(store.del('list',x.id));await safe(store.del('lists',c.id));pickList('main');}}
  if(act==='deltrip'){S.delTrip=id;renderHist();}
  if(act==='deltrip-yes'){S.delTrip=null;safe(store.del('trips',id));}
});

function toast(msg,undo){
  const t=$('toast'); clearTimeout(toast.t);
  t.innerHTML=`<span>${esc(msg)}</span>${undo?'<button type="button" id="undoBtn">Ongedaan maken</button>':''}`; t.hidden=false;
  if(undo) $('undoBtn').onclick=async()=>{t.hidden=true;await undo();};
  toast.t=setTimeout(()=>t.hidden=true,undo?6000:4500);
}
function flash(msg){toast(msg);}
async function removeItem(it){const {id,...data}=it; S.exp=null; await safe(store.del('list',id)); toast(it.name+' verwijderd',async()=>{await safe(store.put('list',id,data));});}

/* ---------- menu (bottom sheet) ---------- */
const MI={
 shop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.3a2 2 0 0 0 2 1.7h7.8a2 2 0 0 0 2-1.6L21 8H6"/></svg>',
 chef:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13.9A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.9V20H6z"/><path d="M6 17h12"/></svg>',
 check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
 save:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
 pen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
 tag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
 trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
 bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
 user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
 out:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
 phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>'};
function renderSheet(){
  const host=$('sheetHost'); if(!S.sheet){host.innerHTML='';return;}
  const c=curList(), done=S.list.filter(x=>x.done).length;
  let inner='';
  if(S.sheet==='menu'){
    const mi=(act,ic,label,sub,cls)=>`<button type="button" class="mi ${cls||''}" data-act="${act}">${MI[ic]}<span>${label}${sub?`<small>${sub}</small>`:''}</span></button>`;
    inner=`<h3>${esc(c.name)}</h3>`+
      mi('m-shop','shop','Winkelmodus','Groot en rustig scherm om af te vinken')+
      (done?mi('m-finish','check','Boodschappen afronden',done+' afgevinkt'):'')+
      (S.list.length?mi('m-savetpl','save','Bewaar als vaste lijst',''):'')+
      mi('m-rename','pen','Naam wijzigen','')+
      mi('m-adv','tag','Jumbo/Plus-advies: '+(c.advice?'aan':'uit'),c.advice?'Tik om uit te zetten':'Tik om aan te zetten')+
      (S.list.length?(S.confirmClear?mi('clear-yes','trash','Ja, maak de hele lijst leeg','Dit kun je niet ongedaan maken','danger'):mi('m-clear','trash','Lijst leegmaken','','danger')):'')+
      (c.id!=='main'?(S.listDel?mi('list-del-yes','trash','Ja, verwijder '+esc(c.name),'Met alle producten erop','danger'):mi('m-del','trash','Lijst verwijderen','','danger')):'')+
      mi('m-home','phone','Op je beginscherm zetten','Open de app als icoon op je telefoon')+
      mi('m-push','bell','Meldingen: '+({on:'aan',off:'uit',denied:'geblokkeerd',unsupported:'niet beschikbaar',nokey:'niet ingesteld'}[S.push]||'…'),{on:'Tik om uit te zetten op dit toestel',off:'Melding als iemand iets toevoegt',denied:'Zet meldingen aan in de instellingen van je telefoon',unsupported:'Op iPhone: zet de app eerst op je beginscherm',nokey:'Zie de handleiding: VAPID-sleutel ontbreekt'}[S.push]||'')+
      mi('m-name','user','Jouw naam: '+esc(MYNAME||'—'),'Zo zien anderen wie iets toevoegde')+
      mi('m-logout','out','Uitloggen','');
  } else if(S.sheet==='name'){
    inner=`<h3>Jouw naam</h3><form class="txt" id="nameForm" style="display:flex;gap:8px;flex-wrap:wrap"><input id="nameInput" value="${esc(MYNAME)}" aria-label="Jouw naam" style="flex:1;min-width:160px;font:500 16px var(--f-body);padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink)"><button class="btn" type="submit">Opslaan</button></form>`;
  } else if(S.sheet==='home'){
    inner=`<h3>Op je beginscherm zetten</h3><div class="txt">
      <b>iPhone (Safari)</b><ol><li>Open deze app-link in Safari.</li><li>Tik onderaan op het deel-icoon (vierkant met pijl).</li><li>Kies <b>Zet op beginscherm</b> en tik op <b>Voeg toe</b>.</li></ol>
      <b>Android (Chrome)</b><ol><li>Open deze app-link in Chrome.</li><li>Tik rechtsboven op de drie puntjes.</li><li>Kies <b>Toevoegen aan startscherm</b>.</li></ol>
      <p class="sub" style="margin:0">Pushmeldingen werken op de iPhone alleen vanaf het beginscherm-icoon.</p></div>
      <button type="button" class="mi" data-act="sheet-close">${MI.check}<span>Klaar</span></button>`;
  }
  host.innerHTML=`<div class="backdrop" data-act="sheet-bg"><div class="sheet2" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div></div>`;
}
function openSheet(k){S.sheet=k;S.confirmClear=false;S.listDel=false;renderSheet();if(k==='menu')pushState().then(st=>{S.push=st;if(S.sheet==='menu')renderSheet();});}
function closeSheet(){S.sheet=null;S.confirmClear=false;S.listDel=false;renderSheet();}
/* ---------- start na inloggen ---------- */
document.addEventListener('submit',async e=>{
  if(e.target.id==='nameForm'){e.preventDefault();const n=$('nameInput').value.trim().slice(0,40);if(!n)return;MYNAME=n;closeSheet();await safe(q(sb.from('profiles').upsert({id:ME,name:n})));toast('Naam opgeslagen');}
});
const TABLES=['items','lists','templates','trips','prices','offers','meta'];
function applyRow(table,ev,row,old){
  if(table==='profiles'){ if(row&&row.id) NAMES[row.id]=row.name||''; return; }
  if(table==='meta'){ if(row&&row.id==='offers') S.meta=row.data; return; }
  if(table==='prices'){ if(ev==='DELETE'){ if(old) delete S.prices[old.id]; } else S.prices[row.id]=row.data; return; }
  if(!S[table]) return;
  if(ev==='DELETE'){ if(old) S[table]=S[table].filter(x=>x.id!==old.id); return; }
  const doc={id:row.id,...(row.data||{})}; const arr=S[table]; const i=arr.findIndex(x=>x.id===row.id);
  if(i>=0) arr[i]=doc; else arr.push(doc);
}
async function loadAll(){
  const res=await Promise.all(TABLES.map(t=>sb.from(t).select('id,data').limit(t==='offers'?3000:1000)));
  const bad=res.find(r=>r.error); if(bad) throw bad.error;
  res.forEach((r,ix)=>{const t=TABLES[ix];
    if(t==='prices'){const p={};r.data.forEach(x=>p[x.id]=x.data);S.prices=p;}
    else if(t==='meta'){const m=r.data.find(x=>x.id==='offers');S.meta=m?m.data:null;}
    else S[t]=r.data.map(x=>({id:x.id,...(x.data||{})}));
  });
  loaded=true; resolveNames(); render();
}
let channel=null;
function subscribeLive(){
  if(channel) sb.removeChannel(channel);
  channel=sb.channel('boodschappen');
  ['items','lists','templates','trips','prices','offers','meta','profiles'].forEach(t=>{
    channel.on('postgres_changes',{event:'*',schema:'public',table:t},p=>{
      applyRow(t,p.eventType,p.new,p.old);
      if(t==='items'&&p.eventType==='INSERT'&&p.new&&p.new.data&&p.new.data.addedBy&&p.new.data.addedBy!==ME){
        const d=p.new.data; resolveNames().then(()=>toast(whoName(d.addedBy)+' zette op '+((allLists().find(l=>l.id===listOf(d))||{}).name||'de lijst')+': '+d.name));
      }
      if(t==='prices'&&S.tab==='lijst'&&S.finishing) return;
      render();
    });
  });
  channel.subscribe();
}
async function startApp(session){
  ME=session.user.id;
  $('login').hidden=true; $('app').hidden=false;
  try{const c=localStorage.getItem('bs-cur');if(c)S.cur=c;}catch(_){}
  try{const t=localStorage.getItem('bs-tab');if(t&&['lijst','vaste','aanbiedingen','geschiedenis'].includes(t))S.tab=t;}catch(_){}
  render();
  const {data:mem,error:memErr}=await sb.from('members').select('email').limit(1);
  if(memErr||!mem||!mem.length){ $('app').hidden=true; showLogin('Dit account heeft nog geen toegang. Laat je e-mailadres toevoegen aan de tabel "members" in Supabase en log opnieuw in.'); await sb.auth.signOut(); return; }
  const {data:prof}=await sb.from('profiles').select('name').eq('id',ME).maybeSingle();
  if(prof&&prof.name) MYNAME=prof.name;
  else { const e=(session.user.email||'').split('@')[0]; MYNAME=e.charAt(0).toUpperCase()+e.slice(1); await sb.from('profiles').upsert({id:ME,name:MYNAME}); }
  try{ await loadAll(); }catch(e){ note('Je lijst kan nu niet geladen worden. Controleer je verbinding en open de app opnieuw.'); return; }
  subscribeLive();
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&loaded){ loadAll().catch(()=>{}); if(!channel||channel.state!=='joined') subscribeLive(); } });
}

/* ---------- boot ---------- */
sb.auth.getSession().then(({ data }) => {
  if (data && data.session) startApp(data.session);
  else showLogin('');
});
