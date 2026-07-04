# Direct Strike Online

Un auto-battler în browser inspirat de **Direct Strike** (mod-ul arcade din StarCraft II).
Nu controlezi unitățile — le cumperi și le plasezi în zona ta, iar la fiecare val întreaga
ta armată respawnează și mărșăluiește automat spre baza inamică. Distruge baza adversarului
ca să câștigi.

**Zero build, zero dependențe:** HTML + CSS + JavaScript (ES modules) + Canvas 2D.

## Cum joci

- **Cumpără unități** din bara de jos (click pe card sau tastele `1`–`9`), apoi **click în zona ta**
  (jumătatea albastră) ca să le plasezi. `Shift`+click plasează mai multe; `Esc` / click-dreapta anulează.
- La fiecare **20 de secunde** pornește un val: toate unitățile plasate spawnează și atacă singure.
  Plasările sunt permanente — armata ta crește de la val la val.
- Primești **venit pasiv** (+10/s). Upgrade-ul de venit (tasta `0`) îl crește permanent cu +4/s.
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
