# Direct Strike Online

Un auto-battler în browser inspirat de **Direct Strike** (mod-ul arcade din StarCraft II).
Nu controlezi unitățile — le cumperi și le plasezi în zona ta, iar la fiecare val întreaga
ta armată respawnează și mărșăluiește automat spre baza inamică. Distruge baza adversarului
ca să câștigi.

**Zero build, zero dependențe:** HTML + CSS + JavaScript (ES modules) + Canvas 2D.

## Cum joci

Harta urmează layout-ul clasic Direct Strike:
`[build zone][bază] — [turn] — mijloc — [turn] — [bază][build zone]`

- **Cumpără unități** din bara de jos (click pe card sau tastele `1`–`9`), apoi **click în build
  zone-ul tău** (dreptunghiul din spatele bazei). `Shift`+click plasează mai multe; `Esc` anulează.
- **Trage cu mouse-ul** o unitate plasată ca s-o repoziționezi; **click-dreapta** pe ea o vinde
  (primești 75% din cost înapoi). Formația contează — valul pornește exact în aranjamentul tău.
- La fiecare **20 de secunde** pornește un val: toată armata din build zone spawnează și mărșăluiește
  singură spre inamic, trecând pe lângă baza și turnul tău.
- Fiecare parte are un **turn defensiv** puternic (lovește sol + aer) la jumătatea drumului. Odată
  distrus, e pierdut definitiv — o gaură permanentă în apărare.
- Primești **venit pasiv** (+10/s). Upgrade-ul de venit (tasta `0`) îl crește permanent cu +4/s.

### Camera (harta e mai mare decât ecranul)

- **Mouse la marginea ecranului** sau **săgeți / WASD** — derulezi harta, ca în WC3/SC2.
- **Rotița mouse-ului** — zoom in/out centrat pe cursor.
- **Space** — salt instant la baza ta.
- **Minimap** (colțul stânga-jos) — vezi toată harta; click sau drag pe el ca să sari oriunde.
- **Fullscreen + captură mouse:** meciul intră automat în fullscreen și capturează mouse-ul
  (cursorul nu poate aluneca pe al doilea monitor — edge-scroll ca într-un RTS nativ).
  **Esc** eliberează mouse-ul și iese din fullscreen; **F** sau butonul ⛶ te bagă înapoi.
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

## Admin: sprite-urile tale

La `https://site-ul-tau/admin/` există un panou de administrare (PHP):

- **Prima vizită:** îți setezi o parolă (salvată doar pe server, în `admin/config.php` —
  neatinsă de `git pull`).
- **Upload:** pentru fiecare unitate × animație (idle/walk/attack/die) încarci **2 frame-uri PNG**.
  Convenție: personajul cu fața spre **dreapta**, centrat, fundal transparent (recomandat 256×256,
  max 1.5 MB). Varianta echipei roșii și oglindirea se generează automat în joc.
- **Fallback:** unde nu ai încărcat imagini, jocul folosește personajele vectoriale integrate
  (Grunt) sau formele geometrice — poți lucra treptat, unitate cu unitate.
- Rezultatul se verifică live în `dev/puppet-preview.html` sau direct în joc.
- Fișierele urcate stau în `assets/units/` pe server (gitignored — deploy-urile nu le ating).

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
