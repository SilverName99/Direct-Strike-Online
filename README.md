# Direct Strike Online

Un auto-battler în browser inspirat de **Direct Strike** (mod-ul arcade din StarCraft II).
Nu controlezi unitățile — le cumperi și le plasezi în zona ta, iar la fiecare val întreaga
ta armată respawnează și mărșăluiește automat spre baza inamică. Distruge baza adversarului
ca să câștigi.

**Zero build, zero dependențe:** HTML + CSS + JavaScript (ES modules) + Canvas 2D.

## Cum joci

Fiecare jucător are o adevărată bază:
`[CONSTRUCȚII: Baza principală + clădiri][ARMATĂ: formația] — turn inițial — mijloc — ...oglindit`

- **Construiește-ți baza** în zona de construcții: **Ziduri** (`Z`, blochează unitățile de sol),
  **Turnuri** (`X`, trag în sol și aer), **Generatoare** (`C`, +4/s venit fiecare — economia ta e
  fizică și atacabilă!). Clădirile sunt fixe; click-dreapta le vinde la 60%.
- **Baza principală** (spatele zonei) e obiectivul: cine o pierde, pierde meciul. **Upgrade-ul ei**
  (tasta `0`) deblochează tier-ele de unități: T1 Grunt/Slinger/Dasher → T2 Bruiser/Lancer/Mender/Wasp
  → T3 Siege Crab/Archon (+1000 HP bazei la fiecare tier).
- **Armata:** cumpără unități (`1`–`9`) și așază-le în fâșia de armată. `Shift`+click plasează mai
  multe; drag le repoziționezi; click-dreapta le vinde la 75%. La fiecare **20s**, formația spawnează
  și mărșăluiește singură spre Baza principală inamică.
- **Plasarea sare pe grid** (comutare cu `G` sau butonul ▦). Unitățile zburătoare trec peste ziduri —
  raiduri aeriene pe economie sunt reale; apără-te cu Slinger/Archon/turnuri.
- Fiecare parte pornește cu un **turn defensiv** la jumătatea drumului — distrus definitiv odată căzut.
- Venit pasiv de bază **+10/s**; restul vine din generatoare.

### Camera (harta e mai mare decât ecranul)

- **Mouse la marginea ecranului** sau **săgeți / WASD** — derulezi harta, ca în WC3/SC2.
- **Rotița mouse-ului** — zoom in/out centrat pe cursor.
- **Space** — salt instant la baza ta.
- **Minimap** (colțul stânga-jos) — vezi toată harta; click sau drag pe el ca să sari oriunde.
- **Fullscreen + captură mouse:** meciul intră automat în fullscreen și capturează mouse-ul
  (cursorul nu poate aluneca pe al doilea monitor — edge-scroll ca într-un RTS nativ).
  Un **Esc** scurt doar eliberează mouse-ul (rămâi în fullscreen); ca să ieși din fullscreen **ții Esc apăsat**
  sau apeși **F** / butonul ⛶, iar un click pe hartă recapturează mouse-ul. (Blocarea tastei Esc merge pe
  browsere Chromium; pe Firefox/Safari Esc iese din fullscreen — limitare de browser.)
- **Contre:** piercing topește armored (Lancer vs Bruiser) · explosive topește swarm-urile light
  (Siege Crab vs Grunts) · unitățile melee și artileria nu pot lovi aerul (Wasp) · anti-aerul
  dedicat e Archon, iar Slinger e răspunsul ieftin.

## Rulare locală

```bash
python3 -m http.server 8000     # sau: npx serve
# apoi deschide http://localhost:8000
```

Merge și direct cu dublu-click pe `index.html` în majoritatea browserelor.

## Teste

Simularea e complet separată de DOM (regulă: nimic din `src/sim/` nu atinge
`document`/`window`/randomness fără seed), deci rulează headless:

```bash
node test/sim-test.js
```

Testele verifică: puritatea simulării, determinismul (același seed → același rezultat),
că un meci AI vs AI se termină, și matchup-urile de contre la cost egal.

## Editor de balans (în admin)

Balansul se editează din panoul de admin (`https://site-ul-tau/admin/`):

- **⚙ stats pe fiecare unitate/clădire** (în pagina de sprites): un panou grupat pe secțiuni
  (**General / Luptă / Ranged & Bounce / Caster & Abilități**). Pentru **unități** — nume, dimensiune
  (Size %), **footprint** (**lățime × înălțime** în celule de grid — cât spațiu ocupă fizic, ca la clădiri),
  cost, tier, HP, damage, perioadă, rază, viteză, splash, armură, tip damage. Pentru **clădiri** — nume,
  dimensiune, footprint (lățime × înălțime), viteza animației idle (cât de repede alternează idle 1↔2),
  cost, HP, cap, rază/damage/venit. Entitățile care trag (unități la distanță și turnul inițial / Tower)
  au în plus **Proiectil (%)** — dimensiunea proiectilului. **Atât unitățile cât și clădirile sunt
  per-rasă** (Humans și Orcs se reglează independent — tab-ul din care editezi). La plasare (clădiri **și
  unități cu footprint > 1×1**), footprint-ul apare colorat pe pătrățelele din grid și ocupă efectiv acele
  celule (o unitate 2×2 stă pe 4 pătrățele și nu se suprapune cu alta). Tier-ul îl setezi
  tot din ⚙ stats, iar jocul îl respectă (o unitate retiered la T1 e disponibilă din start). Cu **▲▼**
  de lângă fiecare unitate **reordonezi roster-ul** — ordinea se salvează și apare la fel în shop-ul din joc.
- **⚙ Balance** (tab separat): reguli generale (bani, venit, interval wave, cap-uri, refund-uri, costuri
  de tier), **colorarea echipelor** („ale mele albastre / inamic roșu", „doar inamicul roșu" sau „fără
  colorare") și **barele de viață** („mereu vizibile" sau „doar când sunt lovite").
- **Background per rasă:** în fiecare tab de rasă poți încărca o imagine de fundal care apare pe toată
  jumătatea acelei rase în joc.

Apeși **Salvează** → se scrie în `assets/balance.json` (gitignored, supraviețuiește la `git pull`) și
devine balansul oficial: jocul îl încarcă la fiecare pornire. **Reset** revine la valorile din cod.

## Casteri și abilități (magie)

Orice unitate poate deveni **caster** din ⚙ stats: bifezi **Caster**, îi setezi **Mana** și
**Regen mană (/s)** și îi alegi până la **5 abilități** din catalog. Abilitățile se aruncă singure
(auto-cast) — nu ai nimic de apăsat în meci; casterii au bară albastră de mana sub cea de viață.

- Bifa **Ranged** (independentă de Caster) face ca atacul de bază al oricărei unități să tragă un
  proiectil; deblochează **Proiectil (%)**, **Viteză proiectil** și slotul de imagine **Proiectil**
  (după Salvează + refresh). Unitățile care erau deja ranged pornesc bifate.
- Bifa **Bounce** (sub Ranged) face ca proiectilul, la impact, să **ricoșeze vizibil** spre următorul
  inamic din apropiere (îl vezi cum zboară de la un caracter la altul), lovind cu **Bounce (% putere)**
  din damage-ul original, în raza **Bounce rază** și pe cel mult **Bounce ținte** salturi — ex. o femeie
  pe panteră cu bumerang. Ținta focusată ia damage-ul complet, ricoșeele iau procentul; salturile rămân
  pe planul țintei (sol la sol, aer la aer) și nu lovesc de două ori aceeași unitate.
- **Când castuiește (regulă generală):** casterul aruncă o abilitate doar când e **angajat** — are un
  inamic în raza lui de atac. Dacă nu, mărșăluiește până intră în rază, apoi castuiește. **Excepție:**
  abilitățile de suport **Heal** și **Regeneration Aura** se pot porni și neangajat, atâta timp cât au
  un aliat rănit în rază.
- **Prioritate la spell-uri:** implicit, cât timp are mană pentru o abilitate, casterul stă la distanță
  și așteaptă să castuiască — nu strecoară auto-attack-uri între spell-uri (când rămâne fără mană,
  atacă normal). Bifa **Auto attacks between spells** îi permite să atace și între cast-uri.
- **Secvențierea cast-urilor** (o abilitate pe rând, în ordine): casterul intră în **„Prepare spell"**
  (windup), apoi pe frame-ul **„Cast X"** se declanșează efectul exact atunci — heal-ul aterizează pe
  aliat (bulinele verzi), proiectilul de Frost Bolt pleacă din mână. Abia după ce efectul se rezolvă
  (la Frost Bolt: **după ce lovește ținta**) revine la „Prepare spell" și **reia abilitățile la rând**,
  aruncând prima pe care o poate folosi. Niciodată două cast-uri în același moment și niciun atac normal
  strecurat între ele — casterul e folosit pentru magiile lui.
- **Cadre de animație (caster):** în loc de 2 frame-uri per acțiune, casterul folosește **un frame comun
  „Prepare spell"** (windup) + câte **un singur frame** pentru fiecare acțiune (Attack, Cast Heal,
  Cast Frost Bolt…). Mai puțin de desenat și fără pâlpâit între poze.

- **Catalogul** (comun ambelor rase, denumiri în engleză) se balansează din **✨ Abilități** (lângă
  ⚙ Balance): **Heal** (cast simplu — cheltuie mană ca să vindece instant aliatul cel mai rănit),
  **Dispel**, **Slow Aura**, **Haste Aura**, **Regeneration Aura**, **Frost Bolt** — fiecare cu cooldown,
  cost de mană, raze, procente, durate. Fiecare abilitate are un **preview live**
  al efectului vizual (același desen procedural ca în joc), ca să vezi cum arată înainte s-o folosești.
- **Aurele (Slow / Haste / Regeneration) sunt aure la cast** (nu pasive): casterul intră în „Prepare
  spell", face **cast** (are frame de „Cast X"), apoi zona de buff/debuff se **menține în jurul lui o
  durată** setabilă — costă mană o dată la cast (nu drenaj/s). Nu o recastuiește cât e activă; dacă are
  ca abilități doar aure, între cast-uri **atacă normal**, iar când zona expiră o ridică din nou. Inelul
  de zonă apare doar cât e activă. (Slow Aura încetinește atacul inamicilor din rază; Haste grăbește
  aliații; Regeneration îi vindecă în timp.)
- Unitățile afectate primesc indicatori (albastru înghețat = încetinit, scântei aurii = grăbit, cruce
  verde = regen, halo alb = imun după Dispell).
- **Abilitățile care se castuiesc** (Heal, Dispel, Frost Bolt, Haste Aura, Regeneration Aura) au VFX
  procedural (inele care se dilată, particule, proiectil cu glow, zona de aură) — nu trebuie desenat
  nimic. Opțional, după ce salvezi selecția, unitatea primește pe pagina de sprites **un slot de Cast**
  (un singur frame „Cast X" per abilitate) pentru poza personajului în timpul cast-ului. Abilitățile
  care trag un proiectil (Frost Bolt) primesc și un slot **de imagine de proiectil per caster** — așa
  doi casteri din rase diferite pot avea Frost Bolt-uri care arată complet diferit (fără imagine,
  rămâne glow-ul procedural).
- Efectele de stare sunt purtate de simulare (deterministe), deci încetinirile chiar reduc viteza
  de atac/mișcare, iar Dispell chiar le curăță — nu e doar vizual.

## Rase

La începutul meciului îți alegi rasa (**Humans** / **Orcs** — AI-ul o joacă pe cealaltă).
Deocamdată rasele diferă doar prin artă (aceleași unități/stats); seturile de imagini se
încarcă per rasă din admin.

## Admin: sprite-urile tale

La `https://site-ul-tau/admin/` există un panou de administrare (PHP):

- **Prima vizită:** îți setezi o parolă (salvată doar pe server, în `admin/config.php` —
  neatinsă de `git pull`).
- **Organizare:** tab per rasă (Humans/Orcs) + navigare rapidă per entitate.
- **Unități:** per unitate încarci **Thumb** (iconița din shop) + **Idle×2, Walk×2, Attack×2,
  Die×1** (un singur frame la moarte). Unitățile care trag de la distanță (Slinger, Lancer, Siege
  Crab, Wasp, Archon) au și un slot **Proiectil** — imaginea desenată în zbor (ex. o bilă albastră);
  se rotește singură spre direcția de zbor.
- **Clădiri** (turnul inițial, Tower, Generator — zidurile rămân vectoriale): **Thumb + Idle×2**
  (frame-urile alternează lent). Clădirile care trag (turnul inițial și Tower) au în plus **Attack×2**
  (redate cât timp au țintă: „fire" imediat după foc, „aim" în rest) și un slot **Proiectil**
  (imaginea trasă, rotită spre direcția de zbor).
- **Baza principală** are **Thumb + o imagine per tier** (Tier 1/2/3): jocul afișează imaginea
  tier-ului curent, iar la upgrade se schimbă automat (dacă un tier n-are imagine, cade pe un tier
  mai mic, apoi pe forma vectorială).
- Convenție: PNG transparent, personajul cu fața spre **dreapta**. Desenează **toate frame-urile
  unei unități pe aceeași pânză pătrată** (ex. 256×256) și compune personajul în ea — jocul redă
  fiecare frame la aceeași scară, deci `die` (întins jos în pânză) apare mic și culcat exact cum
  l-ai desenat, fără redimensionare. Max 1.5 MB. Varianta roșie și oglindirea se generează automat.
- **Fallback:** unde nu ai încărcat imagini, jocul folosește arta vectorială integrată — poți
  lucra treptat, imagine cu imagine.
- Rezultatul se verifică live în `dev/puppet-preview.html?race=humans` sau direct în joc.
- Fișierele urcate stau în `assets/units/<rasă>/…` pe server (gitignored — deploy-urile nu le ating).

## Deploy pe Hostinger

Jocul e static, deci merge pe un website **„Custom PHP/HTML"**:

1. În hPanel creează/alege website-ul → secțiunea **Advanced → Git**.
2. **Create repository**: pune URL-ul acestui repo, branch-ul dorit și directorul `public_html`.
3. Dacă repo-ul e privat, hPanel îți arată o **cheie SSH** — adaug-o în GitHub la
   *Settings → Deploy keys*.
4. (Opțional, auto-deploy) Copiază **webhook-ul** afișat de Hostinger în GitHub la
   *Settings → Webhooks*, ca fiecare push să republice site-ul automat.

## Structura codului

```
src/config.js      — toate valorile ajustabile (economie, valuri, dificultăți)
src/units.js       — roster-ul de unități + matricea de contre (fișierul de balans)
src/sim/           — simularea pură (fixed timestep, seeded RNG, API de comenzi)
src/render/        — desenare Canvas 2D + particule
src/ui/            — HUD, shop, input mouse/tastatură
test/sim-test.js   — teste headless (node)
```

Separarea strictă simulare/randare + comenzi explicite (`game.issueCommand`) pregătesc
terenul pentru multiplayer online (lockstep) într-o etapă viitoare.
