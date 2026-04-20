
// ════════════════════════════════════
// CONFIG
// ════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyD6TmhVacnAL0Z06AIDEVenA2LXC8lLpt8",
  authDomain:        "swissconcierge-9ed88.firebaseapp.com",
  projectId:         "swissconcierge-9ed88",
  storageBucket:     "swissconcierge-9ed88.firebasestorage.app",
  messagingSenderId: "1022632002696",
  appId:             "1:1022632002696:web:a70396eee4523485a28b3d"
};

const STRIPE_LINKS = {
  starter:    "https://buy.stripe.com/4gM14nb8gg9Lc3sdrW18c00",
  pro:        "https://buy.stripe.com/6oUaEX1xG6zb0kKbjO18c01",
  enterprise: "https://buy.stripe.com/00wdR95NW2iV1oOfA418c03",
  credits50:  "https://buy.stripe.com/3cIaEX5NWcXzaZo5Zu18c04",
  credits200: "https://buy.stripe.com/6oUeVda4c7DfebAew018c05",
  portal:     "https://billing.stripe.com/p/login/4gM14nb8gg9Lc3sdrW18c00"
};

const PLANS = {
  trial:      { locations:1,   label:'Trial',      cls:'trial'      },
  starter:    { locations:1,   label:'Starter',    cls:'starter'    },
  pro:        { locations:5,   label:'Pro',        cls:'pro'        },
  enterprise: { locations:999, label:'Enterprise', cls:'enterprise' },
};

const WEATHER_ICONS = {
  0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',
  51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',
  71:'🌨️',73:'❄️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',
  95:'⛈️',96:'⛈️',99:'⛈️'
};

const WEATHER_LABELS = {
  0:'Sonnig',1:'Ueberwiegend sonnig',2:'Teilweise bewoelkt',3:'Bewoelkt',
  45:'Neblig',48:'Neblig',51:'Leichter Nieselregen',53:'Nieselregen',55:'Starker Nieselregen',
  61:'Leichter Regen',63:'Regen',65:'Starker Regen',
  71:'Leichter Schneefall',73:'Schneefall',75:'Starker Schneefall',
  80:'Regenschauer',81:'Regenschauer',82:'Starke Regenschauer',
  95:'Gewitter',96:'Gewitter mit Hagel',99:'Gewitter mit Hagel'
};
// ════════════════════════════════════

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();

let currentUser = null, userProfile = null;
let guestReports = {}, hotelAddress = '', mapInstance = null;

const getGroqKey = () => localStorage.getItem('concierge_groq_key') || '';
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// ── INIT ──
document.addEventListener('DOMContentLoaded', async () => {
  if (await checkJobTrigger()) return;

  const id = new URLSearchParams(window.location.search).get('id');
  if (id) {
    showScreen('guest');
    loadGuestData(id);
    return;
  }

  auth.onAuthStateChanged(async user => {
    if (user) { currentUser = user; await initAfterLogin(); }
    else showScreen('auth');
  });
});

async function initAfterLogin() {
  const doc = await db.collection('users').doc(currentUser.uid).get();
  if (!doc.exists) {
    await db.collection('users').doc(currentUser.uid).set({
      email: currentUser.email, plan:'trial', credits:10,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    userProfile = { plan:'trial', credits:10 };
  } else {
    userProfile = doc.data();
  }

  const plan = userProfile.plan || 'trial';
  if (plan === 'trial' && (userProfile.credits||0) <= 0) { showScreen('paywall'); return; }

  showScreen('admin');
  renderPlanUI();
  document.getElementById('topbarDate').textContent = new Date().toLocaleDateString('de-CH',{weekday:'short',day:'2-digit',month:'short'});
  document.getElementById('sbUserEmail').textContent = currentUser.email;
  document.getElementById('settingsUserId').textContent = currentUser.uid;
  document.getElementById('settingsPlan').textContent = PLANS[plan]?.label || plan;
  document.getElementById('portalLink').href = STRIPE_LINKS.portal;
  checkGroqStatus();
  checkJobTokenStatus();
  await loadLocations();
  await loadReports();
  await fillLocSelect();
  document.getElementById('manualDate').value = today();
}

function renderPlanUI() {
  const plan    = userProfile?.plan || 'trial';
  const credits = userProfile?.credits || 0;
  const cfg     = PLANS[plan] || PLANS.trial;
  const pill    = document.getElementById('planPill');
  pill.textContent = cfg.label;
  pill.className   = 'plan-pill ' + cfg.cls;
  const isCredit   = (plan === 'trial');
  document.getElementById('creditsBar').style.display = isCredit ? 'block' : 'none';
  document.getElementById('statCredits').textContent  = isCredit ? credits : 'unbegrenzt';
  if (isCredit) {
    document.getElementById('creditsLabel').textContent = credits + ' Credits';
    document.getElementById('creditsProgressInner').style.width = Math.min(100,(credits/10)*100)+'%';
    if (credits <= 3) document.getElementById('upgradeBanner').style.display = 'flex';
  }
  document.getElementById('locLimitBadge').textContent   = 'Max. '+cfg.locations+' Standort'+(cfg.locations>1?'e':'');
  document.getElementById('locLimitBadge').style.display = 'inline-flex';

  // Admin-Tab nur fuer Admins anzeigen
  const isAdmin = userProfile && userProfile.isAdmin === true;
  const kundenNav = document.getElementById('nav-kunden');
  if (kundenNav) kundenNav.style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('billingInfo').innerHTML =
    '<span class="badge b-blue">'+cfg.label+'</span> <span style="font-size:13px;color:var(--text2);margin-left:8px">Max. '+cfg.locations+' Standort'+(cfg.locations>1?'e':'')+' · Credits: '+(isCredit?credits:'unbegrenzt')+'</span>';
}

// ── SCREENS ──
function showScreen(n) {
  document.getElementById('authScreen').style.display    = n==='auth'    ? 'flex'  : 'none';
  document.getElementById('paywallScreen').style.display = n==='paywall' ? 'flex'  : 'none';
  document.getElementById('adminApp').style.display      = n==='admin'   ? 'block' : 'none';
  document.getElementById('guestApp').style.display      = n==='guest'   ? 'block' : 'none';
}

// ── AUTH ──
function switchAuth(tab) {
  document.getElementById('auth-login').style.display    = tab==='login'    ? 'block':'none';
  document.getElementById('auth-register').style.display = tab==='register' ? 'block':'none';
  document.getElementById('tab-login').classList.toggle('active', tab==='login');
  document.getElementById('tab-register').classList.toggle('active', tab==='register');
  document.getElementById('authErr').textContent = '';
}
async function doLogin() {
  try { await auth.signInWithEmailAndPassword(document.getElementById('loginEmail').value.trim(), document.getElementById('loginPw').value); }
  catch(e) { document.getElementById('authErr').textContent = e.message; }
}
async function doRegister() {
  const email = document.getElementById('regEmail').value.trim();
  const pw    = document.getElementById('regPw').value;
  if (pw.length < 6) { document.getElementById('authErr').textContent='Passwort min. 6 Zeichen'; return; }
  try { await auth.createUserWithEmailAndPassword(email, pw); }
  catch(e) { document.getElementById('authErr').textContent = e.message; }
}

// ── KUNDEN VERWALTUNG ──
async function activateCustomer() {
  const email   = document.getElementById('customerEmail').value.trim().toLowerCase();
  const plan    = document.getElementById('customerPlan').value;
  const credits = parseInt(document.getElementById('customerCredits').value) || 0;
  const statusEl = document.getElementById('customerStatus');

  if (!email) { toast('Email eingeben!','red'); return; }

  statusEl.innerHTML = '<span class="badge b-amber">Suche Kunde...</span>';

  // User in Firestore nach Email suchen
  const snap = await db.collection('users').where('email','==',email).get();

  if (snap.empty) {
    statusEl.innerHTML = '<span class="badge b-red">Kunde nicht gefunden – hat sich noch nicht registriert!</span>' +
      '<br><small style="color:var(--muted);margin-top:6px;display:block">Der Kunde muss sich zuerst in der App registrieren. Danach hier den Plan setzen.</small>';
    return;
  }

  const userDoc = snap.docs[0];
  await userDoc.ref.update({ plan, credits });

  statusEl.innerHTML = '<span class="badge b-green">Plan aktiviert!</span> ' +
    '<span style="font-size:13px;color:var(--text2)">' + email + ' → ' + plan + ' (' + credits + ' Credits)</span>';

  toast('Plan aktiviert!');
  document.getElementById('customerEmail').value = '';
  await loadCustomers();
}

async function loadCustomers() {
  const el = document.getElementById('customerList');
  el.innerHTML = '<div style="color:var(--muted);font-size:13px">Lade...</div>';
  const snap = await db.collection('users').get();
  if (snap.empty) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">Noch keine Kunden.</p>'; return; }
  const planColors = { trial:'b-amber', starter:'b-blue', pro:'b-purple', enterprise:'b-green' };
  const wrap = document.createElement('div');
  wrap.className = 'tbl-wrap';
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Email</th><th>Plan</th><th>Credits</th><th>Aktion</th></tr></thead>';
  const tbody = document.createElement('tbody');
  snap.docs.sort((a,b)=>(a.data().email||'').localeCompare(b.data().email||'')).forEach(doc => {
    const u = doc.data();
    const cls = planColors[u.plan] || 'b-amber';
    const tr = document.createElement('tr');
    const emailTd = document.createElement('td');
    emailTd.style.color = 'var(--text)';
    emailTd.textContent = u.email || '–';
    const planTd = document.createElement('td');
    planTd.innerHTML = '<span class="badge ' + cls + '">' + (u.plan||'trial') + '</span>';
    const creditsTd = document.createElement('td');
    creditsTd.style.color = 'var(--text2)';
    creditsTd.textContent = u.credits || 0;
    const actionTd = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn btn-o btn-sm';
    btn.textContent = 'Aendern';
    btn.onclick = () => quickSetPlan(doc.id, u.email||'');
    actionTd.appendChild(btn);
    tr.appendChild(emailTd); tr.appendChild(planTd); tr.appendChild(creditsTd); tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  el.innerHTML = '';
  el.appendChild(wrap);
}
async function quickSetPlan(userId, email) {
  const plan = prompt('Neuer Plan fuer ' + email + ':\nstarter / pro / enterprise / trial');
  if (!plan || !['starter','pro','enterprise','trial'].includes(plan)) { toast('Ungültiger Plan','red'); return; }
  const creditsMap = {starter:30,pro:200,enterprise:9999,trial:10};
  await db.collection('users').doc(userId).update({ plan, credits: creditsMap[plan] });
  toast('Plan geaendert!');
  await loadCustomers();
}

async function doLogout() { await auth.signOut(); }

// ── STRIPE ──
function goToStripe(key) {
  const url = STRIPE_LINKS[key];
  if (!url || url.startsWith('STRIPE_')) { toast('Stripe-Link fehlt','amber'); return; }
  window.open(url, '_blank');
}

// ── NAV ──
const PAGES  = ['standorte','reports','erstellen','kunden','billing','settings'];
const TITLES = {standorte:'Standorte',reports:'Tagesreports',erstellen:'Report erstellen',kunden:'Kunden verwalten',billing:'Abonnement',settings:'Einstellungen'};
function switchPage(name) {
  PAGES.forEach(p => {
    document.getElementById('page-'+p).style.display = p===name?'block':'none';
    const n = document.getElementById('nav-'+p);
    if(n) n.classList.toggle('active', p===name);
  });
  document.getElementById('pageTitle').textContent = TITLES[name]||name;
  closeSidebar();
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('overlay').classList.toggle('show');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').classList.remove('show');}

// ── TOAST ──
function toast(msg,type='green'){
  const c={green:'#10b981',red:'#ef4444',blue:'#2563eb',amber:'#f59e0b'};
  const el=document.getElementById('toast');
  el.textContent=msg;el.style.background=c[type]||c.green;
  el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2800);
}

// ── CREDIT GATE ──
async function deductCredit() {
  if (userProfile.plan !== 'trial') return true;
  if ((userProfile.credits||0) <= 0) { toast('Keine Credits','red'); switchPage('billing'); return false; }
  const n = (userProfile.credits||0) - 1;
  await db.collection('users').doc(currentUser.uid).update({credits:n});
  userProfile.credits = n;
  document.getElementById('statCredits').textContent = n;
  document.getElementById('creditsLabel').textContent = n + ' Credits';
  if (n <= 3) document.getElementById('upgradeBanner').style.display = 'flex';
  return true;
}

async function checkLocLimit() {
  const max  = PLANS[userProfile?.plan||'trial']?.locations || 1;
  const snap = await db.collection('locations').where('userId','==',currentUser.uid).get();
  return snap.size < max;
}

// ── WETTER ──
async function fetchWeather(lat, lon) {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&current=temperature_2m,weathercode,windspeed_10m,precipitation&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum&timezone=Europe%2FZurich&forecast_days=1';
    const res = await fetch(url);
    const d   = await res.json();
    const c   = d.current;
    const day = d.daily;
    const code = c.weathercode;
    const wetter = WEATHER_LABELS[code] || 'Wechselhaft';
    const tempAkt = Math.round(c.temperature_2m);
    const tempMax = Math.round(day.temperature_2m_max[0]);
    const tempMin = Math.round(day.temperature_2m_min[0]);
    const wind    = Math.round(c.windspeed_10m);
    const regen   = day.precipitation_sum[0];
    let aktivitaeten = '';
    if (code <= 2)       aktivitaeten = 'ideal fuer Spaziergaenge, Radfahren, Terrassen und Natur-Ausfluge';
    else if (code === 3) aktivitaeten = 'geeignet fuer Stadtbummel, Museen und Cafes';
    else if (code <= 48) aktivitaeten = 'ideal fuer Museen, Cafes, Spa oder Shopping';
    else if (code <= 65) aktivitaeten = 'empfehlenswert: Museen, Kino, Restaurants, Wellnessbereiche';
    else if (code <= 77) aktivitaeten = 'Wintersport moeglich, ansonsten gemuetliche Indoor-Aktivitaeten';
    else                 aktivitaeten = 'besser drinnen: Museen, Cafes, Spa, gute Restaurants';
    return { wetter, tempAkt, tempMax, tempMin, wind, regen, aktivitaeten, code, ok:true };
  } catch(e) { return { ok:false }; }
}

// ── OSM POIs via Overpass ──
async function fetchOsmPOIs(lat, lon, locType, guestProfile) {
  const r = 1200;
  const query = '[out:json][timeout:20];(' +
    'node["amenity"~"restaurant|cafe|bar|fast_food|pharmacy|cinema|theatre|bank|atm"](around:' + r + ',' + lat + ',' + lon + ');' +
    'node["shop"~"supermarket|convenience|bakery|mall"](around:' + r + ',' + lat + ',' + lon + ');' +
    'node["tourism"~"museum|gallery|viewpoint|zoo|attraction"](around:' + r + ',' + lat + ',' + lon + ');' +
    'node["leisure"~"playground|swimming_pool|park|spa|fitness_centre|miniature_golf"](around:' + r + ',' + lat + ',' + lon + ');' +
    ');out body 30;';

  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];

  let d = null;
  for (const mirror of mirrors) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(mirror + '?data=' + encodeURIComponent(query), { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      d = await res.json();
      if (d && d.elements && d.elements.length > 0) break;
    } catch(e) { continue; }
  }

  if (!d || !d.elements || !d.elements.length) return [];
  try {
    const query = '[out:json][timeout:15];('+amenityQuery+');out body 20;';
    const res = await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(query));
    const d   = await res.json();

    const typeLabels = {
      restaurant:'Restaurant', cafe:'Cafe', bar:'Bar', theatre:'Theater',
      museum:'Museum', cinema:'Kino', pharmacy:'Apotheke', library:'Bibliothek',
      supermarket:'Supermarkt', bakery:'Baeckerei', convenience:'Lebensmittel',
      coworking_space:'Coworking', bank:'Bank', atm:'Bankomat', doctors:'Arzt',
      zoo:'Zoo', playground:'Spielplatz', swimming_pool:'Schwimmbad',
      miniature_golf:'Minigolf', spa:'Spa', park:'Park', gallery:'Galerie',
      viewpoint:'Aussichtspunkt'
    };

    const typeIcons = {
      restaurant:'🍽️', cafe:'☕', bar:'🍸', theatre:'🎭',
      museum:'🏛️', cinema:'🎬', pharmacy:'💊', library:'📚',
      supermarket:'🛒', bakery:'🥐', convenience:'🏪',
      coworking_space:'💻', bank:'🏦', atm:'💳', doctors:'🏥',
      zoo:'🦁', playground:'🛝', swimming_pool:'🏊', miniature_golf:'⛳',
      spa:'🧖', park:'🌳', gallery:'🖼️', viewpoint:'🔭'
    };

    return (d.elements||[])
      .filter(e => e.tags && e.tags.name)
      .map(e => {
        const amenity = e.tags.amenity || e.tags.tourism || e.tags.leisure || e.tags.shop || e.tags.historic || 'place';
        const dist = Math.round(Math.sqrt(
          Math.pow((e.lat-lat)*111000,2) +
          Math.pow((e.lon-lon)*111000*Math.cos(lat*Math.PI/180),2)
        ));
        const mapsUrl = 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(e.tags.name)+'+'+encodeURIComponent(e.tags['addr:city']||'')+'&query_place_id=';
        const osmUrl  = 'https://www.openstreetmap.org/?mlat='+e.lat+'&mlon='+e.lon+'&zoom=17';
        return {
          name:    e.tags.name,
          type:    amenity,
          label:   typeLabels[amenity] || amenity,
          icon:    typeIcons[amenity]  || '📍',
          lat:     e.lat,
          lon:     e.lon,
          dist,
          url:     osmUrl,
          website: e.tags.website || e.tags['contact:website'] || null
        };
      })
      .filter((e,i,arr) => arr.findIndex(x=>x.name===e.name)===i) // deduplicate
      .sort((a,b) => a.dist-b.dist)
      .slice(0, 10);
  } catch(e) { console.error('OSM error:', e); return []; }
}


// ── STANDORTE ──
async function addLocation() {
  if (!(await checkLocLimit())) { toast('Standort-Limit erreicht','amber'); switchPage('billing'); return; }
  const name     = document.getElementById('locName').value.trim();
  const addr     = document.getElementById('locAddr').value.trim();
  const wifi     = document.getElementById('locWifi').value.trim();
  const checkin  = document.getElementById('locCheckin').value.trim();
  const checkout = document.getElementById('locCheckout').value.trim();
  if (!name||!addr) { toast('Name & Adresse pflicht!','red'); return; }
  toast('Koordinaten suchen...','blue');
  let lat=47.3769, lon=8.5417;
  try {
    const geo = await fetch('https://nominatim.openstreetmap.org/search?format=json&q='+encodeURIComponent(addr)).then(r=>r.json());
    if(geo[0]){lat=parseFloat(geo[0].lat);lon=parseFloat(geo[0].lon);}
  } catch(e){}
  const locType  = document.getElementById('locType').value;
  const locGuest = document.getElementById('locGuest').value;
  await db.collection('locations').add({name,address:addr,wifiPassword:wifi,checkin,checkout,lat,lon,locType,guestProfile:locGuest,userId:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  toast('Standort gespeichert!');
  ['locName','locAddr','locWifi','locCheckin','locCheckout'].forEach(id=>document.getElementById(id).value='');
  await loadLocations(); await fillLocSelect();
}

async function loadLocations() {
  const snap = await db.collection('locations').where('userId','==',currentUser.uid).get();
  const el   = document.getElementById('locationList');
  if (snap.empty) {
    el.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px 0">Noch keine Standorte.</p>';
    ['statTotal','statRep','statMiss'].forEach(id=>document.getElementById(id).textContent='0');
    return;
  }
  const docs = snap.docs.sort((a,b)=>a.data().name.localeCompare(b.data().name));
  const repSnap = await db.collection('reports').where('date','==',today()).get();
  const hasRep  = new Set(repSnap.docs.map(d=>d.data().locationId));
  document.getElementById('statTotal').textContent = docs.length;
  document.getElementById('statRep').textContent   = hasRep.size;
  document.getElementById('statMiss').textContent  = docs.length - hasRep.size;
  el.innerHTML = docs.map(doc => {
    const l = doc.data();
    return '<div class="loc-item"><div style="flex:1;min-width:0"><div class="loc-name">'+l.name+'</div><div class="loc-addr">'+l.address+'</div><span class="badge '+(hasRep.has(doc.id)?'b-green':'b-amber')+'">'+(hasRep.has(doc.id)?'Report heute':'Kein Report')+'</span></div><div style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-o btn-sm" onclick="copyLink(\''+doc.id+'\')">Link</button><button class="btn btn-d btn-sm" onclick="deleteLoc(\''+doc.id+'\',\''+l.name+'\')">X</button></div></div>';
  }).join('');
}

function copyLink(id){
  const url = window.location.href.split('?')[0]+'?id='+id;
  navigator.clipboard.writeText(url).then(()=>toast('Gast-Link kopiert!'));
}
async function deleteLoc(id,name){
  if(!confirm('Standort "'+name+'" wirklich loeschen?')) return;
  const repSnap = await db.collection('reports').where('locationId','==',id).get();
  const batch = db.batch();
  repSnap.docs.forEach(d=>batch.delete(d.ref));
  batch.delete(db.collection('locations').doc(id));
  await batch.commit();
  toast('Geloescht','amber'); await loadLocations();
}

// ── REPORTS ──
async function loadReports() {
  const snap = await db.collection('reports').where('date','==',today()).get();
  const el   = document.getElementById('reportList');
  if (!snap.size) { el.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px 0">Heute noch keine Reports.</p>'; return; }
  const locIds = [...new Set(snap.docs.map(d=>d.data().locationId))];
  const locMap = {};
  await Promise.all(locIds.map(async id=>{const d=await db.collection('locations').doc(id).get();if(d.exists)locMap[id]=d.data().name;}));
  el.innerHTML='<div class="tbl-wrap"><table><thead><tr><th>Standort</th><th>Datum</th><th>Sprachen</th></tr></thead><tbody>'+
    snap.docs.map(r=>{
      const data=r.data();
      const langs=Object.keys(data).filter(k=>['de','en','fr','it'].includes(k)).join(', ');
      return '<tr><td><strong>'+( locMap[data.locationId]||'–')+'</strong></td><td><span class="badge b-blue">'+data.date+'</span></td><td><span class="badge b-purple">'+langs+'</span></td></tr>';
    }).join('')+'</tbody></table></div>';
}

async function fillLocSelect() {
  const snap = await db.collection('locations').where('userId','==',currentUser.uid).get();
  const docs = snap.docs.sort((a,b)=>a.data().name.localeCompare(b.data().name));
  document.getElementById('manualLoc').innerHTML = docs.map(d=>'<option value="'+d.id+'">'+d.data().name+'</option>').join('');
}

// ── REPORT GENERIEREN (mehrsprachig) ──
async function generateReport() {
  const locId = document.getElementById('manualLoc').value;
  if(!locId){toast('Standort waehlen!','red');return;}
  const key = getGroqKey();
  if(!key){toast('Groq Key fehlt -> Einstellungen','amber');return;}
  if(!(await deductCredit())) return;

  const locDoc = await db.collection('locations').doc(locId).get();
  const loc    = locDoc.data();
  const langs  = ['de','en','fr','it'].filter(l=>document.getElementById('lang-'+l)?.checked);
  if(!langs.length){toast('Mindestens eine Sprache waehlen','red');return;}

  const prog = document.getElementById('genProgress');
  prog.style.display = 'block';
  prog.textContent = 'Wetter wird geladen...';

  const dateStr = new Date().toLocaleDateString('de-CH',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const w = await fetchWeather(loc.lat, loc.lon);
  let wetterInfo = w.ok
    ? 'Aktuelles Wetter: '+w.wetter+', '+w.tempAkt+'C (Max: '+w.tempMax+'C, Min: '+w.tempMin+'C), Wind: '+w.wind+' km/h'+(w.regen>0?', Niederschlag: '+w.regen+'mm':'')+'. Empfohlene Aktivitaeten basierend auf Wetter: '+w.aktivitaeten+'.'
    : 'Typisches Schweizer Wetter fuer die Jahreszeit.';

  // Kontext je nach Typ und Zielgruppe
  const locType      = loc.locType || 'hotel';
  const guestProfile = loc.guestProfile || 'alle';

  const typeContext = {
    hotel:   'Es handelt sich um ein Hotel. Erwaehne Hotelservices, Fruehstueck, Rezeption und lokale Ausflugstipps.',
    airbnb:  'Es handelt sich um eine Airbnb-Ferienwohnung. Erwaehne praktische Infos: nahe Supermaerkte (Migros/Coop), Baeckereien, OeV-Verbindungen, Self-Check-in Hinweise falls relevant. Empfehle lokale Restaurants und Maerkte.',
    bnb:     'Es handelt sich um ein B&B / eine Pension. Erwaehne das persoenliche Ambiente, Fruehstueck und lokale Geheimtipps des Gastgebers.',
    hostel:  'Es handelt sich um ein Hostel. Empfehle guenstige Restaurants, Bars, kostenlose Aktivitaeten und OeV-Tipps.'
  };

  const guestContext = {
    alle:     'Allgemeine Tipps fuer alle Gaeste.',
    familie:  'Die Gaeste sind eine Familie mit Kindern. Erwaehne kinderfreundliche Aktivitaeten: Spielplaetze, Zoo, Schwimmbad, Kino, Minigolf. Erwaehne familienfreundliche Restaurants.',
    kultur:   'Die Gaeste sind an Kultur interessiert. Erwaehne Museen, Theater, Galerien, historische Sehenswuerdigkeiten, Konzerte, Fuehrungen.',
    business: 'Die Gaeste sind Geschaeftsreisende. Kurze, praktische Infos: OeV, Coworking, Banken, gute Restaurants fuer Businesslunch.',
    paerchen: 'Die Gaeste sind ein Paerchen. Erwaehne romantische Aktivitaeten: schoene Restaurants, Aussichtspunkte, Spa, Weinbars, Abendprogramm.',
    senioren: 'Die Gaeste sind Senioren. Erwaehne ruhige, gut erreichbare Aktivitaeten: Parks, Museen, gemutliche Cafes, barrierefreie Wege, OeV.'
  };

  const langNames = {de:'Deutsch',en:'Englisch',fr:'Franzoesisch',it:'Italienisch'};
  const results = {};

  for (const lang of langs) {
    prog.textContent = 'Generiere ' + langNames[lang] + '...';
    try {
      const prompt = 'Erstelle ein freundliches Gaeste-Briefing in der Sprache "'+langNames[lang]+'" fuer "'+loc.name+'" in '+loc.address+'. '+
        'Datum: '+dateStr+'. '+
        (typeContext[locType]||'')+' '+
        (guestContext[guestProfile]||'')+' '+
        wetterInfo+' '+
        'Baue Wetter, Unterkunftstyp und Zielgruppe konkret in den Text ein. '+
        'Hinweis auf SBB-Fahrplan nicht vergessen. '+
        'Max 230 Woerter, herzlicher Ton, keine Ueberschriften, zusammenhaengender Fliestext.';

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
        body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:400,messages:[{role:'user',content:prompt}]})
      });
      const d = await res.json();
      if(d.error) throw new Error(d.error.message);
      results[lang] = d.choices[0].message.content.trim();
      if(lang==='de') document.getElementById('manualContent').value = results[lang];
      await new Promise(r=>setTimeout(r,600));
    } catch(e) { prog.textContent = 'Fehler bei '+lang+': '+e.message; }
  }

  // In Firestore speichern
  const date = document.getElementById('manualDate').value;
  if(date && Object.keys(results).length) {
    const existing = await db.collection('reports').where('locationId','==',locId).where('date','==',date).get();
    const payload = Object.assign({locationId:locId,date,source:'manual',updatedAt:firebase.firestore.FieldValue.serverTimestamp()},results);
    if(!existing.empty) { await existing.docs[0].ref.update(payload); }
    else { payload.createdAt=firebase.firestore.FieldValue.serverTimestamp(); await db.collection('reports').add(payload); }
    await loadReports();
  }

  prog.textContent = 'Fertig! '+Object.keys(results).length+' Sprache(n) generiert.';
  setTimeout(()=>{prog.style.display='none';},3000);
  toast('Report generiert!');
}

async function saveManual() {
  const locId   = document.getElementById('manualLoc').value;
  const date    = document.getElementById('manualDate').value;
  const content = document.getElementById('manualContent').value.trim();
  if(!locId||!date||!content){toast('Alle Felder ausfuellen!','red');return;}
  const existing = await db.collection('reports').where('locationId','==',locId).where('date','==',date).get();
  const payload  = {locationId:locId,date,de:content,source:'manual',updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
  if(!existing.empty){await existing.docs[0].ref.update(payload);}
  else{payload.createdAt=firebase.firestore.FieldValue.serverTimestamp();await db.collection('reports').add(payload);}
  toast('Report gespeichert!'); await loadReports();
}

// ── BILLING ──
async function addCreditsManual() {
  const amount=parseInt(document.getElementById('creditAddAmount').value)||0;
  if(amount<=0){toast('Ungueltige Anzahl','red');return;}
  const n=(userProfile.credits||0)+amount;
  await db.collection('users').doc(currentUser.uid).update({credits:n});
  userProfile.credits=n;
  document.getElementById('statCredits').textContent=n;
  document.getElementById('creditAddAmount').value='';
  toast(amount+' Credits gutgeschrieben!');
  renderPlanUI();
}

// ── SETTINGS ──
function saveGroqKey(){const k=document.getElementById('groqKeyInput').value.trim();if(!k){toast('Key leer!','red');return;}localStorage.setItem('concierge_groq_key',k);document.getElementById('groqKeyInput').value='';toast('Key gespeichert!');checkGroqStatus();}
function deleteGroqKey(){localStorage.removeItem('concierge_groq_key');toast('Key geloescht','amber');checkGroqStatus();}
function checkGroqStatus(){
  const key=localStorage.getItem('concierge_groq_key');
  const el=document.getElementById('groqStatus');if(!el)return;
  el.innerHTML=key?'<span class="badge b-green">Key gesetzt</span> <span style="font-family:monospace;font-size:12px;color:var(--muted)">'+key.substring(0,8)+'...</span>':'<span class="badge b-amber">Kein Key gesetzt</span>';
}

// ── JOB TOKEN ──
function saveJobToken(){const t=document.getElementById('jobTokenInput').value.trim();if(!t){toast('Token leer!','red');return;}localStorage.setItem('concierge_job_token',t);document.getElementById('jobTokenInput').value='';toast('Token gespeichert!');updateTriggerUrl();checkJobTokenStatus();}
function updateTriggerUrl(){const token=localStorage.getItem('concierge_job_token')||'';const base=window.location.href.split('?')[0];const el=document.getElementById('triggerUrlDisplay');if(el)el.value=token?base+'?job='+encodeURIComponent(token):'(Token zuerst setzen)';}
function copyTriggerUrl(){const el=document.getElementById('triggerUrlDisplay');if(!el||el.value.includes('Token')){toast('Token zuerst setzen!','amber');return;}navigator.clipboard.writeText(el.value).then(()=>toast('URL kopiert!'));}
function checkJobTokenStatus(){const t=localStorage.getItem('concierge_job_token');const el=document.getElementById('jobTokenStatus');if(!el)return;el.innerHTML=t?'<span class="badge b-green">Token gesetzt</span> <span style="font-family:monospace;font-size:11px;color:var(--muted)">'+t.substring(0,6)+'...</span>':'<span class="badge b-amber">Kein Token</span>';updateTriggerUrl();}

async function runJobNow() {
  const key = getGroqKey();
  if (!key) { toast('Groq Key fehlt!','amber'); return; }
  const logEl = document.getElementById('jobLog');
  logEl.style.display='block'; logEl.innerHTML='';
  const log = (msg,color) => { const d=document.createElement('div');d.style.color=color||'var(--text2)';d.textContent=msg;logEl.appendChild(d);logEl.scrollTop=logEl.scrollHeight; };
  const dateStr = today();
  const dateLong = new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date());
  log('=== Report-Job gestartet ===');
  log('Datum: '+dateLong);
  const snap = await db.collection('locations').get();
  if(snap.empty){log('Keine Locations.','var(--amber)');return;}
  log(snap.size+' Location(s) gefunden');
  let ok=0,fail=0;
  for(const doc of snap.docs){
    const loc=doc.data();
    log('Generiere: '+loc.name);
    try{
      const w=await fetchWeather(loc.lat,loc.lon);
      if(w.ok)log('  Wetter: '+w.wetter+' '+w.tempAkt+'C');
      const wetterInfo=w.ok?'Aktuelles Wetter: '+w.wetter+', '+w.tempAkt+'C (Max: '+w.tempMax+'C). Aktivitaeten: '+w.aktivitaeten+'.':'Typisches Schweizer Wetter.';
      const results={};
      for(const lang of ['de','en','fr','it']){
        const langNames={de:'Deutsch',en:'Englisch',fr:'Franzoesisch',it:'Italienisch'};
        const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{
          method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
          body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:400,
            messages:[{role:'user',content:'Erstelle ein Gaeste-Briefing in "'+langNames[lang]+'" fuer "'+loc.name+'" ('+( loc.locType||'hotel')+') in '+loc.address+'. Zielgruppe: '+(loc.guestProfile||'alle')+'. Datum: '+dateLong+'. '+wetterInfo+' Inhalte passend zum Unterkunftstyp und zur Zielgruppe, Wetter+Aktivitaeten, lokale Tipps, SBB-Hinweis. Max 230 Woerter, herzlicher Ton, kein Ueberschriften.'}]
          })
        });
        const d=await res.json();
        if(d.error)throw new Error(d.error.message);
        results[lang]=d.choices[0].message.content.trim();
        await new Promise(r=>setTimeout(r,500));
      }
      const existing=await db.collection('reports').where('locationId','==',doc.id).where('date','==',dateStr).get();
      const payload=Object.assign({locationId:doc.id,date:dateStr,source:'cron',updatedAt:firebase.firestore.FieldValue.serverTimestamp()},results);
      if(!existing.empty){await existing.docs[0].ref.update(payload);}
      else{payload.createdAt=firebase.firestore.FieldValue.serverTimestamp();await db.collection('reports').add(payload);}
      log('  OK – DE/EN/FR/IT gespeichert','#10b981'); ok++;
      await new Promise(r=>setTimeout(r,800));
    }catch(e){log('  Fehler: '+e.message,'var(--red)');fail++;}
  }
  log('=== Fertig: '+ok+' OK'+(fail?', '+fail+' Fehler':'')+' ===',ok>0?'#10b981':'var(--red)');
  if(ok>0){toast('Reports generiert!');await loadReports();}
}

async function checkJobTrigger() {
  const jobParam=new URLSearchParams(window.location.search).get('job');
  if(!jobParam)return false;
  const savedToken=localStorage.getItem('concierge_job_token');
  if(!savedToken||jobParam!==savedToken){document.body.innerHTML='<div style="padding:40px;font-family:monospace;color:red">403 Invalid token</div>';return true;}
  document.body.innerHTML='<div id="jobOut" style="padding:40px;font-family:monospace;font-size:13px;background:#0f172a;color:#94a3b8;min-height:100vh;white-space:pre-wrap"></div>';
  const out=document.getElementById('jobOut');
  const log=(msg)=>{out.textContent+=msg+'\n';};
  log('Swiss Concierge AI – Automated Report Job');
  log('Time: '+new Date().toISOString());
  const key=localStorage.getItem('concierge_groq_key');
  if(!key){log('ERROR: Groq key not set');return true;}
  const dateStr=today();
  const dateLong=new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date());
  const snap=await db.collection('locations').get();
  log('Locations: '+snap.size);
  let ok=0,fail=0;
  for(const doc of snap.docs){
    const loc=doc.data();log('Processing: '+loc.name);
    try{
      const w=await fetchWeather(loc.lat,loc.lon);
      const wetterInfo=w.ok?'Wetter: '+w.wetter+', '+w.tempAkt+'C. Aktivitaeten: '+w.aktivitaeten+'.':'Typisches Schweizer Wetter.';
      const results={};
      for(const lang of ['de','en','fr','it']){
        const langNames={de:'Deutsch',en:'Englisch',fr:'Franzoesisch',it:'Italienisch'};
        const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{
          method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
          body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:400,
            messages:[{role:'user',content:'Erstelle ein Gaeste-Briefing in "'+langNames[lang]+'" fuer "'+loc.name+'" ('+(loc.locType||'hotel')+') in '+loc.address+'. Zielgruppe: '+(loc.guestProfile||'alle')+'. Datum: '+dateLong+'. '+wetterInfo+' Max 230 Woerter, herzlicher Ton, keine Ueberschriften.'}]
          })
        });
        const d=await res.json();
        if(d.error)throw new Error(d.error.message);
        results[lang]=d.choices[0].message.content.trim();
        await new Promise(r=>setTimeout(r,500));
      }
      const existing=await db.collection('reports').where('locationId','==',doc.id).where('date','==',dateStr).get();
      const payload=Object.assign({locationId:doc.id,date:dateStr,source:'cron',updatedAt:firebase.firestore.FieldValue.serverTimestamp()},results);
      if(!existing.empty){await existing.docs[0].ref.update(payload);}
      else{payload.createdAt=firebase.firestore.FieldValue.serverTimestamp();await db.collection('reports').add(payload);}
      log('  OK – 4 languages saved'); ok++;
      await new Promise(r=>setTimeout(r,800));
    }catch(e){log('  ERROR: '+e.message);fail++;}
  }
  log('Done: '+ok+' ok, '+fail+' failed');
  return true;
}

// ── GAST VIEW ──
async function loadGuestData(id) {
  const locDoc = await db.collection('locations').doc(id).get();
  if (!locDoc.exists) { document.getElementById('gContent').textContent='Standort nicht gefunden.'; return; }
  const loc = locDoc.data();

  document.getElementById('gHotelName').textContent = loc.name;
  hotelAddress = loc.address;
  document.getElementById('gDate').textContent = new Date().toLocaleDateString('de-CH',{weekday:'long',day:'2-digit',month:'long'});

  // WLAN
  if(loc.wifiPassword){document.getElementById('wifiCard').style.display='flex';document.getElementById('gWifi').textContent=loc.wifiPassword;}

  // Check-in/out
  if(loc.checkin||loc.checkout){
    document.getElementById('checkinCard').style.display='block';
    if(loc.checkin)document.getElementById('gCheckin').textContent=loc.checkin;
    if(loc.checkout)document.getElementById('gCheckout').textContent=loc.checkout;
  }

  // Wetter anzeigen
  const w = await fetchWeather(loc.lat, loc.lon);
  if(w.ok){
    const bar=document.getElementById('weatherBar');
    bar.style.display='flex';
    document.getElementById('weatherIcon').textContent=WEATHER_ICONS[w.code]||'🌤️';
    document.getElementById('weatherTemp').textContent=w.tempAkt+'°C';
    document.getElementById('weatherDesc').textContent=w.wetter;
    document.getElementById('weatherDetail').textContent='Max '+w.tempMax+'° · Min '+w.tempMin+'° · Wind '+w.wind+' km/h'+(w.regen>0?' · '+w.regen+'mm Niederschlag':'');
  }

  // Report laden
  const repSnap = await db.collection('reports').where('locationId','==',id).where('date','==',today()).get();
  if(repSnap.empty){
    document.getElementById('gContent').innerHTML='<span style="color:var(--muted)">Fuer heute liegt noch kein Briefing vor.</span>';
  } else {
    guestReports = repSnap.docs[0].data();
    const lang = document.getElementById('guestLang').value;
    document.getElementById('gContent').textContent = guestReports[lang] || guestReports['de'] || 'Kein Inhalt.';
  }

  // Karte
  initMap(loc.lat, loc.lon, loc.name);

  // POIs laden
  const locType      = loc.locType || 'hotel';
  const guestProfile = loc.guestProfile || 'alle';
  document.getElementById('restoCard').style.display='block';
  const restoTitle = document.querySelector('#restoCard .g-card-title');
  if(restoTitle){const titles={hotel:'Restaurants & Aktivitaeten',airbnb:'Einkaufen, Essen & Aktivitaeten',bnb:'Restaurants & Umgebung',hostel:'Guenstig Essen & Aktivitaeten'};restoTitle.textContent=titles[locType]||'Umgebung';}
  const pois = await fetchOsmPOIs(loc.lat, loc.lon, locType, guestProfile);
  const restoEl = document.getElementById('restoList');
  if(!pois.length){
    restoEl.innerHTML='<p style="color:var(--muted);font-size:13px">Keine Orte in der Naehe gefunden – Radius wird erhoehen...</p>';
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'restaurant-grid';
    pois.forEach(p => {
      const card = document.createElement('div');
      card.className = 'resto-card';
      const link = p.website || p.url;
      if(link){card.style.cursor='pointer';card.onclick=()=>window.open(link,'_blank');}
      const iconDiv = document.createElement('div');
      iconDiv.className = 'resto-icon';
      iconDiv.textContent = p.icon;
      const infoDiv = document.createElement('div');
      infoDiv.style.flex = '1';
      const nameDiv = document.createElement('div');
      nameDiv.className = 'resto-name';
      nameDiv.textContent = p.name;
      const typeDiv = document.createElement('div');
      typeDiv.className = 'resto-type';
      typeDiv.textContent = p.label;
      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(typeDiv);
      const metaDiv = document.createElement('div');
      metaDiv.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:4px';
      const distDiv = document.createElement('div');
      distDiv.className = 'resto-dist';
      distDiv.textContent = p.dist+'m';
      metaDiv.appendChild(distDiv);
      if(link){const linkDiv=document.createElement('div');linkDiv.style.cssText='font-size:10px;color:var(--blue-bright)';linkDiv.textContent='Maps →';metaDiv.appendChild(linkDiv);}
      card.appendChild(iconDiv);card.appendChild(infoDiv);card.appendChild(metaDiv);
      wrap.appendChild(card);
    });
    restoEl.innerHTML='';
    restoEl.appendChild(wrap);
  }
}

function switchLang() {
  const lang = document.getElementById('guestLang').value;
  if (guestReports && guestReports[lang]) {
    document.getElementById('gContent').textContent = guestReports[lang];
  } else if (guestReports && guestReports['de']) {
    document.getElementById('gContent').textContent = guestReports['de'] + '\n\n(Uebersetzung nicht verfuegbar)';
  }
}

function copyWifi() {
  navigator.clipboard.writeText(document.getElementById('gWifi').textContent)
    .then(() => toast('Passwort kopiert!'));
}

function initMap(lat, lon, name) {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  mapInstance = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([lat, lon], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);
  L.marker([lat, lon]).addTo(mapInstance).bindPopup(name).openPopup();
}

function downloadPDF() {
  const hotelName  = document.getElementById('gHotelName').textContent || 'Concierge';
  const date       = document.getElementById('gDate').textContent || new Date().toLocaleDateString('de-CH');
  const reportText = document.getElementById('gContent').textContent || '';
  const wifi       = document.getElementById('gWifi')?.textContent || '';
  const checkin    = document.getElementById('gCheckin')?.textContent || '';
  const checkout   = document.getElementById('gCheckout')?.textContent || '';
  const lang       = document.getElementById('guestLang')?.value || 'de';

  // Wetter
  const weatherTemp = document.getElementById('weatherTemp')?.textContent || '';
  const weatherDesc = document.getElementById('weatherDesc')?.textContent || '';
  const weatherDetail = document.getElementById('weatherDetail')?.textContent || '';

  // Restaurants / POIs sammeln
  const poiCards = document.querySelectorAll('#restoList .resto-card');
  const pois = [];
  poiCards.forEach(card => {
    const name = card.querySelector('.resto-name')?.textContent || '';
    const type = card.querySelector('.resto-type')?.textContent || '';
    const dist = card.querySelector('.resto-dist')?.textContent || '';
    if (name) pois.push({ name, type, dist });
  });

  const langLabels = { de:'Deutsch', en:'English', fr:'Français', it:'Italiano', es:'Español', ja:'日本語', zh:'中文' };

  // HTML fuer Print/PDF
  const printHTML = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>${hotelName} – Gäste-Briefing</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a2e; line-height: 1.6; }

  .header { background: #2563eb; color: white; padding: 24px 28px; border-radius: 10px; margin-bottom: 20px; }
  .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .header .date { font-size: 13px; opacity: 0.85; }
  .header .powered { font-size: 10px; opacity: 0.6; margin-top: 8px; }

  .section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-bottom: 14px; }
  .section-title { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #64748b; margin-bottom: 10px; }

  .info-row { display: flex; gap: 24px; margin-bottom: 10px; }
  .info-item label { font-size: 10px; color: #94a3b8; display: block; margin-bottom: 2px; text-transform: uppercase; letter-spacing: .5px; }
  .info-item span { font-size: 16px; font-weight: 700; color: #2563eb; }

  .wifi-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .wifi-label { font-size: 10px; color: #2563eb; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 2px; }
  .wifi-pwd { font-family: monospace; font-size: 18px; font-weight: 700; color: #2563eb; }

  .weather-bar { display: flex; align-items: center; gap: 14px; padding: 10px 0; border-bottom: 1px solid #e2e8f0; margin-bottom: 10px; }
  .weather-temp { font-size: 28px; font-weight: 800; }
  .weather-desc { font-size: 13px; color: #475569; }
  .weather-detail { font-size: 11px; color: #94a3b8; }

  .report-text { font-size: 13px; line-height: 1.8; color: #1e293b; white-space: pre-wrap; }

  .poi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .poi-item { background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }
  .poi-name { font-size: 12px; font-weight: 600; }
  .poi-type { font-size: 10px; color: #94a3b8; }
  .poi-dist { font-size: 11px; color: #2563eb; font-weight: 600; }

  .qr-note { text-align: center; padding: 14px; background: #f1f5f9; border-radius: 8px; font-size: 11px; color: #64748b; margin-top: 14px; }
  .footer { text-align: center; font-size: 10px; color: #94a3b8; margin-top: 20px; padding-top: 12px; border-top: 1px solid #e2e8f0; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>${hotelName}</h1>
  <div class="date">${date}${lang !== 'de' ? ' &nbsp;·&nbsp; ' + (langLabels[lang]||lang) : ''}</div>
  <div class="powered">Swiss Concierge AI · Powered by ZeroGen</div>
</div>

${wifi ? `<div class="wifi-box">
  <div>
    <div class="wifi-label">WLAN Passwort</div>
    <div class="wifi-pwd">${wifi}</div>
  </div>
</div>` : ''}

${(checkin || checkout) ? `<div class="section">
  <div class="section-title">Check-in / Check-out</div>
  <div class="info-row">
    ${checkin  ? `<div class="info-item"><label>Check-in</label><span>${checkin}</span></div>` : ''}
    ${checkout ? `<div class="info-item"><label>Check-out</label><span>${checkout}</span></div>` : ''}
  </div>
</div>` : ''}

${(weatherTemp || weatherDesc) ? `<div class="section">
  <div class="section-title">Wetter heute</div>
  <div class="weather-bar">
    <div class="weather-temp">${weatherTemp}</div>
    <div>
      <div class="weather-desc">${weatherDesc}</div>
      <div class="weather-detail">${weatherDetail}</div>
    </div>
  </div>
</div>` : ''}

<div class="section">
  <div class="section-title">Tages-Briefing</div>
  <div class="report-text">${reportText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
</div>

${pois.length ? `<div class="section">
  <div class="section-title">Restaurants & Aktivitaeten in der Naehe</div>
  <div class="poi-grid">
    ${pois.map(p => `<div class="poi-item">
      <div><div class="poi-name">${p.name}</div><div class="poi-type">${p.type}</div></div>
      <div class="poi-dist">${p.dist}</div>
    </div>`).join('')}
  </div>
</div>` : ''}

<div class="qr-note">
  Dieses Briefing wurde automatisch von Swiss Concierge AI generiert.
  Weitere Infos und aktualisierte Reports: QR-Code scannen.
</div>

<div class="footer">
  Swiss Concierge AI · ZeroGen · ${new Date().getFullYear()} &nbsp;·&nbsp; ${date}
</div>

</body>
</html>`;

  // Neues Fenster oeffnen und drucken
  const win = window.open('', '_blank', 'width=800,height=1000');
  win.document.write(printHTML);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 600);
}


function openSBB() {
  window.open('https://www.sbb.ch/de/kaufen/pages/fahrplan/fahrplan.xhtml?von=' + encodeURIComponent(hotelAddress), '_blank');
}
