// generate-reports.js
// Läuft täglich via GitHub Actions um 06:00 CH-Zeit
// Liest alle Locations aus Firebase → generiert Report via Groq → schreibt zurück

import admin from 'firebase-admin';
import fetch from 'node-fetch';

// ── FIREBASE INIT via Service Account ──
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // GitHub Actions speichert den Key mit literal \n – das muss ersetzt werden
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

// ── DATUM ──
const today = new Date();
const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
const dateLong = today.toLocaleDateString('de-CH', {
  weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  timeZone: 'Europe/Zurich'
});

console.log(`\n🏨 Swiss Concierge AI – Daily Report Job`);
console.log(`📅 Datum: ${dateLong} (${dateStr})\n`);

// ── GROQ CALL ──
async function generateReport(locationName, address) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Erstelle ein freundliches, informatives Gäste-Briefing auf Deutsch für das Hotel/den Standort "${locationName}" in ${address}.
Datum heute: ${dateLong}.
Inhalte:
- Herzlicher Willkommensgruss mit aktuellem Datum
- Allgemeiner Schweizer Wetter-Hinweis für die Jahreszeit
- 2-3 konkrete lokale Tipps (Restaurants, Sehenswürdigkeiten, Aktivitäten)
- Hinweis auf SBB-Fahrplan für ÖV-Verbindungen
Stil: Max. 200 Wörter, herzlicher Ton, keine Überschriften, zusammenhängender Text.`
      }]
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'github-actions'
    });
  }
}

// ── MAIN ──
async function main() {
  // Alle Locations laden
  const snap = await db.collection('locations').get();

  if (snap.empty) {
    console.log('⚠️  Keine Locations gefunden – Job beendet.');
    process.exit(0);
  }

  console.log(`📍 ${snap.size} Location(s) gefunden\n`);

  let success = 0;
  let failed  = 0;

  for (const doc of snap.docs) {
    const loc = doc.data();
    console.log(`➜ Generiere Report für: ${loc.name} (${loc.address})`);

    try {
      const content = await generateReport(loc.name, loc.address);
      await upsertReport(doc.id, content);
      console.log(`  ✅ Gespeichert (${content.length} Zeichen)`);
      success++;

      // Rate-Limit: kurze Pause zwischen den Calls
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.error(`  ❌ Fehler: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n═══════════════════════════════`);
  console.log(`✅ Erfolgreich: ${success}`);
  if (failed > 0) console.log(`❌ Fehlgeschlagen: ${failed}`);
  console.log(`═══════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
