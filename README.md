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

- **⚙ stats pe fiecare unitate/clădire** (în pagina de sprites): pentru **unități** — nume, dimensiune
  (Size %), cost, tier, HP, damage, perioadă, rază, viteză, splash, armură, tip damage. Pentru **clădiri**
  — nume, dimensiune, footprint (**lățime × înălțime** în celule de grid), viteza animației idle (cât de
  repede alternează idle 1↔2), cost, HP, cap, rază/damage/venit. Entitățile care trag (unități la distanță
  și turnul inițial / Tower) au în plus **Proiectil (%)** — dimensiunea proiectilului. **Atât unitățile cât și clădirile sunt
  per-rasă** (Humans și Orcs se reglează independent — tab-ul din care editezi). La plasare, footprint-ul
  apare colorat pe pătrățelele din grid, cu imaginea de idle 1 a clădirii pe cursor.
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
Bifa **Ranged caster** (apare doar după „Caster") face ca atacul de bază să tragă un proiectil și
deblochează slotul de imagine **Proiectil** (după Salvează + refresh). **Casting-ul are prioritate:**
cât timp aruncă o abilitate, casterul nu dă și auto-attack; între cast-uri / când rămâne fără mană,
atacă normal.

- **Catalogul** (comun ambelor rase, denumiri în engleză) se balansează din **✨ Abilități** (lângă
  ⚙ Balance): **Heal** (cast simplu — cheltuie mană ca să vindece instant aliatul cel mai rănit),
  **Dispel**, **Slow Aura**, **Haste Aura**, **Regeneration Aura**, **Frost Bolt** — fiecare cu cooldown,
  cost de mană (la aure: drenaj/s), raze, procente, durate. Fiecare abilitate are un **preview live**
  al efectului vizual (același desen procedural ca în joc), ca să vezi cum arată înainte s-o folosești.
- **Aurele** sunt pasive: cerc de rune rotitor sub caster + inel discret cu raza reală; unitățile
  afectate primesc indicatori (vârtej albastru = încetinit, scântei aurii = grăbit, cruce verde =
  regen, halo alb = imun după Dispell).
- **Abilitățile active** (Dispell, Săgeata de gheață) au VFX procedural (inele care se dilată,
  particule, proiectil cu glow) — nu trebuie desenat nimic. Opțional, după ce salvezi selecția,
  unitatea primește pe pagina de sprites **sloturi de Cast** (2 frame-uri per abilitate activă)
  pentru poza personajului în timpul cast-ului.
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
