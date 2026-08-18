# Anti-stalemate approaches

Late game can stall: both sides finish research, armies trade in midfield, bases never fall, and coins pile with nowhere meaningful to go. Win still requires wiping enemy buildings, so a symmetric mid fight has no timer or pressure to force a result.

Below are four **fundamentally different** ways to add depth and a path to victory/defeat without muddying the current clear loop (build → spawn → fight → siege). Each draws from a different game tradition. Pick one to deep-dive later.

---

## 1. Production specialization (unit-branch commitment)

**Inspired by:** Age of Empires unit upgrades, Company of Heroes squad doctrines, factory roles in Factorio/RTS.

**Idea:** Barracks, Factory, and Helipad can be **specialized** (paid commitment on that building) so they stop making the generalist unit and instead produce a **glass-cannon counter** tuned for one enemy type. Team-wide research stays for broad buffs; specialization is the local, readable bet that breaks mirror matches.

**Why it breaks stalemates:** Equal generalist armies cancel out. Specializing creates asymmetric armies — strong into the opponent’s composition, weak into the wrong one — so mid fights resolve instead of forever trading, and wrong reads get punished hard enough that bases open.

**Details:**
- Each producer has **two specializations** (pick one; rebuild or pay to respec if we allow switching).
- **Barracks:** Rifleman → **Sniper** (long range, fragile, shreds helicopters / soft targets) or **Missile infantry** (anti-armor, slow fire, dies to splash).
- **Factory:** Tank → **AA tank** (can engage helis, weaker vs ground) or **Tank buster** (high single-target vs vehicles, poor vs swarms).
- **Helipad:** Helicopter → **Combat medic / booster** (aura heal or damage buff for nearby ground; weak own DPS) or **Gunship** (anti-infantry strafe / chin-gun focus; soft vs armor — the opposite of Hellfire tank-hunting).
- Specialized units are **clearly weaker outside their niche** (glass cannons), so committing wrong is a real loss.
- Cost/time to specialize should matter (coins + short offline window) so you don’t flip every fight for free.
- UI: specialize from the selected building; thumb/model change makes the new role obvious on the field.

---

## 2. Contested front & escalating siege rights

**Inspired by:** Battlefield / Planetside territory control, League inhibitors, King of the Hill overtime.

**Idea:** The center isn’t only +coins. Whoever **holds the hill (or a frontline zone) long enough** unlocks stacking **siege rights**: temporary buffs that only matter for ending games (bonus damage to buildings/turrets, longer range vs structures, or a temporary forward rally so survivors push the base instead of reclumping mid).

**Why it breaks stalemates:** Mid control becomes the path to *base pressure*, not just bank. Coins stop being the only prize; holding the fight converts into the ability to crack turrets and slots. Losing the hill is a real threat even if your army looks even.

**Details:**
- Capture progress (or timed sole control) grants **siege tiers** (e.g. T1: +building damage, T2: ignore some turret regen, T3: short “breach” window).
- Tiers **decay** when you lose the zone so leads aren’t permanent free wins.
- Optional: contested overtime meter — after N minutes of neither side destroying a building, hill control ticks faster or siege tiers escalate automatically so someone *must* crack.
- Keep the visual language simple: flag/front marker + one clear “siege active” cue on your units or HUD.
- Does not require new unit types; depth comes from **where** you fight and **when** you cash the advantage.

---

## 3. War chest doctrines (spend the pile on decisive plays)

**Inspired by:** C&C / Red Alert superweapons, card-game finishers, RTS “epic” abilities.

**Idea:** When research is largely done, surplus coins fuel a small set of **doctrines / war powers** — expensive, cooldown-gated, highly readable one-shot or short-window effects that exist to **end or reopen** games, not to chip mid trades forever.

**Why it breaks stalemates:** Piled money becomes a clock and a threat. Both players see a doctrine charging and must play around the swing (push before it lands, or save for the answer). Stalemate money stops being dead value.

**Details:**
- 3–5 doctrines max, mutually exclusive or heavy opportunity cost (pick a doctrine tree early, or unlock slots with lab).
- Examples of different roles: **Artillery barrage** (damage in a zone, great vs clumped mid or turret line), **Forced march** (all units briefly rush / ignore chase to hit buildings), **Sabotage** (enemy producer pauses briefly), **Reinforcement drop** (one-time elite wave), **Scorched earth** (your collapsing building explodes for siege damage).
- Long charge + visible telegraph so it feels fair and readable, not random.
- Costs should soak late banks (hundreds of coins) so “I have nothing to buy” disappears.
- Clarity rule: one icon, one effect, one counterplay (push, spread, save doctrine, or destroy the lab that enables them).

---

## 4. Attrition & supply collapse

**Inspired by:** Hearts of Iron / grand strategy supply, war weariness, chess endgame material races, survival “hunger” clocks.

**Idea:** Prolonged even wars **tax the economy and the army**. Upkeep, ammo, or “war strain” rises the longer neither side takes buildings. Depots and supply trucks become the **lifeline**; choke them and the mid army withers. Alternatively, idle coin surplus itself triggers strain (hoarding isn’t free).

**Why it breaks stalemates:** Standing still becomes losing. You must either break through, cut the enemy’s supply, or spend into a risky push — infinite mid trading eventually collapses one side’s production or combat effectiveness.

**Details:**
- **Upkeep:** each living unit (or each producer) drains coins/sec after a grace period; unpaid upkeep → spawn pause or combat debuff.
- **Supply radius / convoy dependency:** units far from a friendly supply truck or depot fight weaker; trucks become strategic targets, not only income.
- **War strain meter:** increases while no building has been destroyed for X seconds; at thresholds, both sides take penalties (slower spawns, less healing/regen) or the weaker economy cracks first.
- Optional soft cap: excess coins above a threshold convert poorly or accelerate strain so endless banking hurts.
- Depth is logistical (what you protect, when you commit trucks, when you force a base hit) rather than new DPS unit types.
- Keep feedback loud: strain bar, desaturated/weak units when undersupplied, clear “spawns halted — unpaid upkeep”.

---

## Comparison (quick)

| # | Core lever | New stuff players learn | Breaks stall by… |
|---|------------|-------------------------|------------------|
| 1 | Composition commitment | Specialized unit roles | Asymmetric counters, not mirror trades |
| 2 | Map control → siege | Front/hill as win condition fuel | Mid win converts into base crack |
| 3 | Spend piled coins on finishers | Doctrines / war powers | Banks become decisive threats |
| 4 | Time & logistics tax | Upkeep / supply / strain | Standing still collapses someone |

None of these require sacrificing the current clarity of “buildings spawn units, units fight, destroy buildings to win” — they each add one new *kind* of decision on top.
