// generate-reports.js
// Läuft täglich via GitHub Actions um 06:00 CH-Zeit
// CommonJS (require) – kompatibel mit allen Node.js Versionen

const admin = require('firebase-admin');
const https = require('https');

// ── FIREBASE INIT ──
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

// ── DATUM (Schweizer Zeit) ──
const now = new Date();
const dateStr = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zurich', year:'numeric', month:'2-digit', day:'2-digit'
}).format(now); // YYYY-MM-DD

const dateLong = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  weekday:'long', day:'2-digit', month:'long', year:'numeric'
}).format(now);

console.log('\n=== Swiss Concierge AI – Daily Report Job ===');
console.log('Datum: ' + dateLong + ' (' + dateStr + ')\n');

// ── GROQ API (natives https, kein node-fetch nötig) ──
function groqCall(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama3-70b-8192',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });

    const options = {
      hostname: 'api.groq.com',
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.choices[0].message.content.trim());
        } catch(e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── UPSERT REPORT ──
async function upsertReport(locationId, content) {
  const existing = await db.collection('reports')
    .where('locationId', '==', locationId)
    .where('date', '==', dateStr)
    .get();

  if (!existing.empty) {
    await existing.docs[0].ref.update({
      content,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'github-actions'
    });
  } else {
    await db.collection('reports').add({
      locationId,
      date: dateStr,
      content,
      source: 'github-actions',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

// ── MAIN ──
async function main() {
  // Secrets prüfen
  if (!process.env.FIREBASE_PROJECT_ID) { console.error('FEHLER: FIREBASE_PROJECT_ID fehlt'); process.exit(1); }
  if (!process.env.FIREBASE_CLIENT_EMAIL) { console.error('FEHLER: FIREBASE_CLIENT_EMAIL fehlt'); process.exit(1); }
  if (!process.env.FIREBASE_PRIVATE_KEY) { console.error('FEHLER: FIREBASE_PRIVATE_KEY fehlt'); process.exit(1); }
  if (!process.env.GROQ_API_KEY) { console.error('FEHLER: GROQ_API_KEY fehlt'); process.exit(1); }

  const snap = await db.collection('locations').get();

  if (snap.empty) {
    console.log('Keine Locations gefunden – Job beendet.');
    process.exit(0);
  }

  console.log(snap.size + ' Location(s) gefunden\n');

  let success = 0, failed = 0;

  for (const doc of snap.docs) {
    const loc = doc.data();
    console.log('Generiere: ' + loc.name + ' (' + loc.address + ')');

    try {
      const prompt = 'Erstelle ein freundliches Gäste-Briefing auf Deutsch für "' + loc.name + '" in ' + loc.address + '. ' +
        'Datum: ' + dateLong + '. ' +
        'Inhalte: Willkommensgruss, allgemeiner Schweizer Wetter-Hinweis, 2-3 lokale Tipps (Restaurants, Sehenswürdigkeiten, ÖV), Hinweis auf SBB-Fahrplan. ' +
        'Max 200 Wörter, herzlicher Ton, keine Überschriften.';

      const content = await groqCall(prompt);
      await upsertReport(doc.id, content);
      console.log('  OK – ' + content.length + ' Zeichen gespeichert');
      success++;

      // Rate-Limit Pause
      await new Promise(r => setTimeout(r, 1200));

    } catch(err) {
      console.error('  FEHLER: ' + err.message);
      failed++;
    }
  }

  console.log('\n=== Ergebnis ===');
  console.log('Erfolgreich: ' + success);
  if (failed > 0) console.log('Fehlgeschlagen: ' + failed);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
