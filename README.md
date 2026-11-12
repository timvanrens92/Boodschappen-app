# Boodschappen

Een gedeelde boodschappenlijst voor het hele huishouden, met elke week de aanbiedingen van Jumbo en PLUS en advies waar je iets het beste haalt.

- Meerdere lijsten (bijvoorbeeld "Boodschappen" en "Duitsland"), vaste lijsten (zoals "Verjaardag") en een geschiedenis van eerdere boodschappenrondes, met uitgaven per maand.
- De lijst staat op gangpad gesorteerd. Je kunt vegen om af te vinken of te verwijderen, en er is een winkelmodus.
- Je ziet live wat de ander toevoegt, en je krijgt een pushmelding op je telefoon.
- Elke woensdag haalt een GitHub-workflow de nieuwe aanbiedingen op.

De app is een statische webapp (Vite) op **GitHub Pages**. De gegevens en het inloggen lopen via **Supabase** (gratis). Je installeert de app via "Zet op beginscherm".

---

## Online zetten (eenmalig, ongeveer 20 minuten)

Je hebt drie bestanden die níet in deze repository staan. Je hebt ze apart gekregen:

- `geheimen.txt`: de sleutels voor pushmeldingen en de webhook.
- `eigen-gegevens.sql`: jullie e-mailadressen en je vaste lijst uit de oude app.
- (deze README)

### 1. Supabase-project aanmaken
1. Ga naar <https://supabase.com>, maak een gratis account aan en klik **New project**.
2. Kies een naam (bv. `boodschappen`), een databasewachtwoord en als regio **Central EU (Frankfurt)**.

### 2. Database inrichten
In Supabase → **SQL Editor** → **New query**. Plak en draai (**Run**) in deze volgorde:
1. `supabase/schema.sql` (tabellen, beveiliging en live bijwerken).
2. `supabase/seed-offers.sql` (de aanbiedingen van deze week, zodat de app meteen gevuld is).
3. `eigen-gegevens.sql`. Vul eerst bovenin jullie twee e-mailadressen in. Alleen deze adressen krijgen toegang.

### 3. Accounts aanmaken
1. Supabase → **Authentication → Sign In / Providers**: zet **Allow new users to sign up** **uit**. Zo kan niemand anders een account maken.
2. **Authentication → Users → Add user → Create new user**: maak een account voor jezelf en een voor je vrouw. Gebruik dezelfde e-mailadressen als in stap 2, kies een wachtwoord en vink **Auto Confirm User** aan.

### 4. Pushmeldingen (Edge Function)
1. Supabase → **Edge Functions → Deploy a new function → Via Editor**.
2. Noem hem `notify` en plak de inhoud van `supabase/functions/notify/index.ts`.
3. Zet bij de functie-instellingen **Verify JWT** uit. De webhook beveiligt de functie met een eigen geheim.
4. **Edge Functions → Secrets**: voeg toe (de waarden staan in `geheimen.txt`):
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `WEBHOOK_SECRET`
   - `VAPID_SUBJECT` = `mailto:` + je eigen e-mailadres
5. **Database → Webhooks → Create a new hook**:
   - Table: `items`, Events: alleen **Insert**
   - Type: **HTTP Request**, Method: `POST`
   - URL: `https://<jouw-project>.supabase.co/functions/v1/notify`
   - HTTP Headers: `x-webhook-secret` = de waarde van `WEBHOOK_SECRET`

### 5. GitHub instellen
In deze repository → **Settings**:
1. **Pages** → Source: **GitHub Actions**.
2. **Secrets and variables → Actions → Variables** → **New repository variable**:
   - `SUPABASE_URL`: de Project URL (Supabase → Project Settings → API)
   - `SUPABASE_ANON_KEY`: de *anon public* key (zelfde plek)
   - `VAPID_PUBLIC_KEY`: uit `geheimen.txt`
3. **Secrets and variables → Actions → Secrets** → **New repository secret**:
   - `SUPABASE_SERVICE_ROLE_KEY`: de *service_role* key (Project Settings → API). Deze sleutel is geheim: zet hem alleen hier neer.
4. **Actions** → workflow **App publiceren** → **Run workflow**.
   De app staat daarna op `https://<gebruikersnaam>.github.io/boodschappen-app/`.
5. **Actions** → workflow **Aanbiedingen ophalen** → **Run workflow**. Zo test je of het ophalen werkt.

### 6. Op je telefoon zetten
- **iPhone:** open de link in **Safari** → deel-icoon → **Zet op beginscherm**. Open de app via het icoon en zet in het menu (de drie puntjes) **Meldingen** aan. Op de iPhone werken meldingen alleen vanaf het beginscherm-icoon (iOS 16.4 of nieuwer).
- **Android:** open de link in **Chrome** → drie puntjes → **Toevoegen aan startscherm** (of **App installeren**). Zet daarna in het menu **Meldingen** aan.

---

## Eigen domein (optioneel)
Wil je bv. `boodschappen.jouwdomein.nl`?
1. Zet bij je domeinprovider een CNAME van `boodschappen` naar `<gebruikersnaam>.github.io`.
2. Repository → Settings → Pages → **Custom domain**: vul het domein in en vink **Enforce HTTPS** aan.
3. Zet de repository-variabele `APP_BASE` op `/` en draai **App publiceren** opnieuw.

## Aanbiedingen
De workflow `.github/workflows/offers.yml` draait elke woensdag om 05:17 UTC. Hij opent de aanbiedingenpagina's van Jumbo en PLUS in een browser, leest de zichtbare tekst en herkent daarin de acties: "1+1 gratis", "2 voor € 3,99", "25% korting", "2e halve prijs" en "voor € 0,99".

- Herkent hij per winkel minder dan 10 aanbiedingen, dan blijven de oude staan. In de app zie je dan nog de aanbiedingen van vorige week.
- Bij elke run wordt de ruwe paginatekst bewaard als download (**paginatekst**). Werkt het herkennen niet meer omdat een site anders is opgebouwd, dan kun je daarmee `scripts/offers-lib.mjs` bijwerken.
- Supermarkten blokkeren soms automatische bezoekers, en hun voorwaarden staan dit waarschijnlijk niet toe. Gebruik het alleen voor jezelf.

Lokaal testen zonder iets weg te schrijven: `npx playwright install chromium && DRY_RUN=1 node scripts/fetch-offers.mjs`

## Lokaal ontwikkelen
```bash
npm install
cp .env.example .env.local   # vul je Supabase-gegevens in
npm run dev
```

## Opbouw
| Pad | Wat |
|---|---|
| `index.html`, `src/main.js`, `src/style.css` | De app |
| `public/sw.js`, `public/manifest.webmanifest`, `public/icons/` | Installeerbaar maken, offline openen, pushmeldingen |
| `supabase/schema.sql` | Tabellen en beveiliging (alleen e-mailadressen in `members` hebben toegang) |
| `supabase/seed-offers.sql` | Startvulling aanbiedingen |
| `supabase/functions/notify/` | Pushmelding bij een nieuw product |
| `scripts/fetch-offers.mjs`, `scripts/offers-lib.mjs` | Aanbiedingen ophalen en herkennen |
| `.github/workflows/` | Publiceren naar Pages en de wekelijkse aanbiedingen |
