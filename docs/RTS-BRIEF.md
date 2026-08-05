# Brief: pornirea jocului RTS (proiect nou, Godot 4)

Acest document e scris ca să fie citit de un asistent AI la începutul unui chat nou
în care sunt atașate DOUĂ repo-uri:

- **`SilverName99/Direct-Strike-Online`** — jocul existent, terminat și online la
  https://fangs-and-honor.com/ . **Nu se mai modifică.** E doar sursă de date, de
  asseturi și de design.
- **repo-ul nou** — jocul RTS, de la zero, în Godot 4.

---

## 1. Cine sunt și ce vreau

Sunt dezvoltator solo. Vorbesc **română — răspunde-mi întotdeauna în română.**

Am construit deja un auto-battler în browser (JS + canvas + PHP). Funcționează,
e online, e echilibrat, are 3 rase și conținut real. Îl las exact așa cum e.

Vreau acum un **RTS clasic în stil Warcraft 3**, ca joc desktop nativ:
- o hartă, două zone de start (jucător + AI);
- culegi aur și lemn cu muncitori;
- construiești clădiri oriunde pe hartă;
- recrutezi și **controlezi direct** soldații (select, move, attack, patrol, hold);
- tech tree, upgrade-uri, abilități.

**Motivul principal pentru care schimb tehnologia:** în browser animațiile erau
tăiate la 8–20 de cadre exportate ca sprite-uri PNG. Vreau **animații complete**,
la fps real, redate din fișierul Blender. Vreau să arate frumos și elegant.

## 2. Decizia tehnică (deja luată — nu o redeschide)

**Godot 4.x, renderer Forward+, GDScript.**

Motivele, ca să nu le re-derivezi:
- 3D nativ → `.glb` din Blender cu toate acțiunile, redate cu `AnimationPlayer`,
  la lungime completă. Problema care a motivat tot proiectul dispare complet.
- Gratis, MIT, editor mic, iterație rapidă.
- Scara mea e WC3 (~50–150 unități pe hartă), nu 5000 — deci nu am nevoie de
  Unity DOTS. `NavigationServer3D` + avoidance e suficient.
- Poate exporta și pe web mai târziu, dacă vreau.

C# se poate adăuga ulterior dacă un sistem chiar cere, dar **default e GDScript**.

## 3. Ce experiență am deja (folosește-o, nu mă învăța de la zero)

- **Blender:** modelez/import din Meshy, rig Mixamo (`mixamorig:*`), retarget de
  animații între personaje, weight painting, atașare de arme la os, shape keys,
  decimate, pack resources, camere ortografice, export.
- **Meshy:** text-to-3D și text-to-motion pentru animații custom.
- **JS/PHP:** nivel bun. Godot/GDScript: **începător** — explică-mi sintaxa și
  convențiile Godot când le folosești prima dată.

## 4. Ce e în repo-ul vechi (harta lui)

### Date de balans — **se portează integral**

| Fișier | Ce conține |
|---|---|
| `src/units.js` | `DAMAGE_MATRIX` (normal/piercing/explosive × light/armored/structure) + rosterul de bază, cu `hp`, `damage`, `period`, `range`, `speed`, `armor`, `dmgType`, `splash`, `projectile`, `isAir`, `targetsAir` |
| `src/race-units.js` | **3 rase** (`orcs`, `humans`, `undead`) × 9 sloturi de unități, complet rezolvate, cu numele reale (Footman, Grunt, Archer, Javelin thrower, Griffin rider, Wyvern rider, Boar rider, Necromancer, Grave Digger etc.) |
| `src/abilities.js` | **49 de abilități**, cu `kind` ∈ {`active`, `aura`, `castaura`, `passive`, `summon`}, parametri numerici și descrieri RO + EN |
| `src/upgrades.js` | **18 upgrade-uri**, fiecare cu `kind`, `params` și descrieri RO + EN |
| `src/config.js` | constante globale, listele de clădiri (`CONFIG.BUILDINGS`), grid, versiune |
| `assets/balance.json` (pe server, nu în repo) | tuning-ul aplicat peste toate cele de mai sus |

**Toate descrierile există deja în română ȘI engleză** (`desc`/`descEn`,
`tip`/`tipEn`). Jocul nou trebuie să fie bilingv din start — nu inventa texte noi
unde există deja.

### Logică de simulare — **se portează ca specificație, nu ca cod**

`src/sim/` (~6100 linii, determinist, fără DOM/Date/Math.random, rulează headless):

| Fișier | Linii | De ce contează |
|---|---|---|
| `combat.js` | 1396 | Formulele de damage, armor, splash, bounce, proiectile, threat/targeting. **Cel mai valoros fișier din tot repo-ul.** Transcrie formulele 1:1. |
| `abilities.js` | 1504 | Cum se execută cele 49 de abilități (aure, summon-uri, cast-uri) |
| `game.js` | 1355 | Economie (gold, food/farms), tier-uri, construcție, upgrade-uri, owner vs team |
| `ai.js` | 797 | Comportamentul AI-ului actual |
| `entity.js` | 436 | Modelul de unitate/structură |
| `movement.js` | 286 | Deplasare + separare între unități |
| `layout.js`, `match.js`, `waves.js`, `rng.js` | ~290 | Layout hartă, ciclul de meci, valuri, RNG determinist |

**Insight-ul cheie de arhitectură:** jocul vechi e deja un RTS în care fiecare
unitate are un ordin permanent de *attack-move* spre baza inamică. RTS-ul nou =
același combat + un **sistem de ordine** deasupra. Combatul nu se reinventează.

### Ce NU se portează

- `src/render/` — renderer canvas 2D, sprite manifest, tint-uri, corpse fade.
  Godot face tot asta nativ.
- `admin/` (PHP) — panoul de upload de cadre, `manifest.json`, limitele de
  `max_file_uploads`. **Editorul Godot ÎNLOCUIEȘTE complet acest panou.**
- `src/net/` — lockstep peste relay. Conceptul rămâne, codul se rescrie peste
  `ENetMultiplayerPeer`.
- `src/ui/` — HUD-ul DOM. Se rescrie în Control nodes.

### Asseturile 3D

Sprite-urile PNG stau pe server, **nu** în repo (`assets/` are doar 12K).
Asseturile reale sunt **fișierele `.blend` locale ale mele** — modele Meshy
riguite Mixamo, cu animații `idle`, `walk`, `attack`, `die` (+ `construct` la
clădiri). Le aduc eu în repo-ul nou ca `.glb`.

**Acestea nu se pierd — devin asseturile de producție ale jocului nou, în loc
să fie doar sursă pentru sprite-uri.**

## 5. Structura repo-ului nou

```
project.godot            # Godot 4.x, Forward+
assets/
  models/units/          # human/footman.glb, orc/grunt.glb, undead/ghoul.glb ...
  models/buildings/
  terrain/  sfx/  music/  ui/
data/                    # portat din repo-ul vechi
  units/*.tres           # UnitData resources
  abilities/*.tres
  upgrades/*.tres
  races/*.tres
scenes/
  units/unit.tscn        # UN SINGUR scene, parametrizat din UnitData
  buildings/building.tscn
  world/map.tscn
  ui/hud.tscn
scripts/
  core/                  # stats, damage, orders, resources, selection
  ai/
  net/
docs/
  DESIGN.md
```

**Regulă de la primul commit: un singur `unit.tscn`,** configurat dintr-un
resource `UnitData`. Nu 27 de scene copiate. Adăugarea unei unități = un fișier
de date + un `.glb`.

`.gitattributes` cu `*.glb filter=lfs diff=lfs merge=lfs -text` — modelele umflă
istoricul altfel.

## 6. Roadmap (fiecare fază trebuie să fie jucabilă la final)

| # | Fază | Conținut |
|---|---|---|
| 0 | **Vertical slice** | Cameră RTS (top-down înclinată, zoom scroll, pan WASD/margini), un plan, footman-ul meu din `.glb`, click-dreapta → merge via `NavigationAgent3D`, animația comută corect `idle`↔`walk` **la lungime completă** |
| 1 | **Selecție & ordine** | Click, drag-select (box), shift-add, control groups 1–9, ordine: Move / Attack / Attack-Move / Stop / Hold / Patrol, coadă cu Shift |
| 2 | **Combat** | Portarea `DAMAGE_MATRIX` + formulelor din `combat.js`, proiectile, splash, moarte + animația `die` completă |
| 3 | **Economie** | Aur + **lemn** (nou), muncitori care culeg și cară, food/supply din ferme |
| 4 | **Construcție** | Plasare liberă pe hartă cu ghost + validare teren, muncitor care construiește, animația `construct` |
| 5 | **Producție & tech** | Cozi de recrutare în clădiri, tier-uri, cele 18 upgrade-uri, cele 49 de abilități |
| 6 | **Hartă & fog** | Teren real (heightmap), copaci/mine, fog of war, minimap |
| 7 | **AI** | Adversar care culege, construiește, atacă în valuri — **cea mai grea parte, nu prima** |
| 8 | **Multiplayer** | `ENetMultiplayerPeer`, 1v1 LAN întâi |

Estimare realistă: **3–6 luni** până la un RTS jucabil. Codul se scrie de la zero;
designul e deja făcut și testat, ceea ce e partea grea la majoritatea proiectelor.

## 7. Primul task concret

Nu începe cu economia, nici cu AI-ul, nici cu portarea celor 49 de abilități.

**Faza 0, exact:**
1. Proiect Godot gol, `project.godot` comis.
2. Cameră RTS funcțională.
3. Un plan cu material simplu.
4. Footman-ul meu (`.glb`) instanțiat, cu `AnimationPlayer`.
5. Click dreapta → se deplasează cu `NavigationAgent3D`, animația trece pe `walk`
   și revine la `idle` când ajunge.

Momentul în care văd footman-ul mergând pe hartă cu animația întreagă validează
toată decizia. Ar trebui să fie fezabil rapid — modelul există deja.

## 8. Cum vreau să lucrezi

- **Răspunde în română.** Întotdeauna.
- **Verifică prin măsurare, nu prin afirmație.** În proiectul vechi am lucrat
  mereu așa: script care rulează, cifre înainte/după. Menține obiceiul (headless
  Godot: `godot --headless --script ...`).
- **Commit + push** la fiecare schimbare terminată, cu mesaj descriptiv.
- **Versiune bumpată** într-un fișier de config la fiecare push (așa am făcut și
  în proiectul vechi — sunt la v24.4 acolo).
- Când portezi date din repo-ul vechi, **portează-le în bloc**, nu bucată cu
  bucată — sunt date mecanice.
- Spune-mi clar când ceva e o limitare reală, nu ocoli.
- Nu modifica repo-ul vechi. E terminat și online.
