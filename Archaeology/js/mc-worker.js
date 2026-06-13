/* Auto-generated — node scripts/bundle-mc-worker.cjs */
(function() {
"use strict";
var modules = {};
modules["build"] = (function() {
/**
 * Aggregate combat stats from a fixed build (upgrades + stat levels + externals).
 */

const BASE_DAMAGE = 10;
const BASE_MAX_STAMINA = 100;
const BASE_CRIT_DAMAGE_MULTIPLIER = 1.5;
const BASE_ULTRA_CRIT_DAMAGE_MULTIPLIER = 3;

function baseDamageFromLookup(lookup) {
  const v = lookup?.combat?.base_damage;
  return typeof v === "number" && v > 0 ? v : BASE_DAMAGE;
}

function baseCritDamageMultFromLookup(lookup) {
  const v = lookup?.combat?.base_crit_damage_multiplier;
  return typeof v === "number" && v > 0 ? v : BASE_CRIT_DAMAGE_MULTIPLIER;
}

function baseUltraCritDamageMultFromLookup(lookup) {
  const v = lookup?.combat?.base_ultra_crit_damage_multiplier;
  return typeof v === "number" && v > 0 ? v : BASE_ULTRA_CRIT_DAMAGE_MULTIPLIER;
}

const STAT_IDS = [
  "strength",
  "agility",
  "perception",
  "intellect",
  "luck",
  "divinity",
  "corruption",
];

function sumUpgradeEffects(build, lookup) {
  const totals = {};
  const byId = lookup._upgradeById;
  const levels = build.upgrade_levels || {};
  for (const tierUps of Object.values(levels)) {
    if (typeof tierUps !== "object") continue;
    for (const [id, lv] of Object.entries(tierUps)) {
      const def = byId[id];
      if (!def?.per_level || !lv) continue;
      for (const [key, per] of Object.entries(def.per_level)) {
        totals[key] = (totals[key] || 0) + per * lv;
      }
    }
  }
  const gem = build.gem_levels || {};
  const archLevel = build.archaeology_level ?? 1;
  const eff = (nominal) => Math.min(nominal, archLevel + 4);
  for (const g of lookup.gem_upgrades.upgrades) {
    const lv = Math.min(gem[g.id] || 0, eff(g.nominal_cap));
    for (const [key, per] of Object.entries(g.per_level)) {
      totals[key] = (totals[key] || 0) + per * lv;
    }
  }
  return totals;
}

function statCap(statId, build, lookup) {
  const def = lookup.stat_points.stats[statId];
  if (!def) return 0;
  if ((build.ascension ?? 0) < (def.unlock?.ascension ?? 0)) return 0;
  let cap = def.level_cap_base;
  const mythic = build.upgrade_levels?.mythic?.exp_gain_2x_stat_caps ?? 0;
  if (mythic > 0) cap += 5 * mythic;
  return cap;
}

function totalStatBudget(build) {
  return build.archaeology_level ?? 1;
}

function sumAllocated(statLevels) {
  return STAT_IDS.reduce(
    (s, id) => s + Math.max(0, Math.floor(statLevels[id] || 0)),
    0,
  );
}

/** Clamp each stat to [0, cap]. Fixes invalid DOM / optimizer drift. */
function clampStatLevels(statLevels, build, lookup) {
  const out = { ...statLevels };
  for (const id of STAT_IDS) {
    const cap = statCap(id, build, lookup);
    const v = Math.floor(out[id] || 0);
    out[id] = Math.max(0, Math.min(cap, v));
  }
  return out;
}

/** Per-upgrade lines for one effect key (fragment + gem upgrades). */
function upgradeEffectLines(build, lookup, effectKey) {
  const lines = [];
  const byId = lookup._upgradeById;
  const levels = build.upgrade_levels || {};
  for (const [tier, tierUps] of Object.entries(levels)) {
    if (!tierUps || typeof tierUps !== "object") continue;
    for (const [id, lv] of Object.entries(tierUps)) {
      const def = byId?.[id];
      const per = def?.per_level?.[effectKey];
      if (!per || !lv) continue;
      lines.push({
        source: id,
        tier,
        level: lv,
        perLevel: per,
        amount: per * lv,
      });
    }
  }
  const archLevel = build.archaeology_level ?? 1;
  const eff = (nominal) => Math.min(nominal, archLevel + 4);
  for (const g of lookup.gem_upgrades?.upgrades || []) {
    const lv = Math.min(build.gem_levels?.[g.id] || 0, eff(g.nominal_cap));
    const per = g.per_level?.[effectKey];
    if (!per || !lv) continue;
    lines.push({
      source: `gem:${g.id}`,
      tier: "gem",
      level: lv,
      perLevel: per,
      amount: per * lv,
    });
  }
  return lines;
}

/** Displayed crit damage % bonuses (fractions); each applies to base crit mult, not flat add. */
function critDamageBonusFraction(build, lookup) {
  const up = sumUpgradeEffects(build, lookup);
  const sl = build.stat_levels || {};
  const str = sl.strength || 0;
  const strCritPer =
    lookup?.stat_points?.stats?.strength?.per_point?.crit_damage_percent ?? 0.03;
  return (up.crit_damage_percent || 0) + str * strCritPer;
}

function critDamageMultiplierFromBuild(build, lookup) {
  const baseCrit = baseCritDamageMultFromLookup(lookup);
  return baseCrit * (1 + critDamageBonusFraction(build, lookup));
}

/** Super/ultra crit damage: % bonuses multiply base tier mults (matches Other MC). */
function superUltraCritDamageMults(up, lookup) {
  const bonus = up.super_crit_damage_percent || 0;
  return {
    superCritDamageMult: 2 * (1 + bonus),
    ultraCritDamageMult:
      baseUltraCritDamageMultFromLookup(lookup) * (1 + bonus),
  };
}

function chance(v) {
  return Math.min(1, Math.max(0, v || 0));
}

function avadaKedaEffects(build, lookup) {
  if (!build?.has_avada_keda) {
    return {
      durationExtraHits: 0,
      flurryStaminaOnCastExtra: 0,
      flurrySpeedDurationExtraHits: 0,
      cooldownAttacks: 0,
      instachargeChance: 0,
    };
  }
  const effects = lookup?.external_unlocks?.avada_keda?.effects_when_owned || {};
  const durationExtraHits = effects.ability_duration_extra_hits ?? 5;
  const flurryStaminaOnCastExtra =
    effects.flurry_stamina_on_cast_extra ?? durationExtraHits;
  return {
    durationExtraHits,
    flurryStaminaOnCastExtra,
    flurrySpeedDurationExtraHits:
      effects.flurry_speed_duration_extra_hits ?? durationExtraHits,
    cooldownAttacks: effects.all_ability_cooldown_attacks ?? -10,
    instachargeChance: effects.ability_instacharge_chance ?? 0.03,
  };
}

function externalFragmentGainMultiplier(build, lookup) {
  const ex = lookup?.external_unlocks || {};
  let mult = 1;

  if (build?.has_fragment_bundle) {
    mult *= ex.fragment_bundle_iap?.fragment_gain_multiplier ?? 1.25;
  }

  if (build?.has_cave_legendary_fish_level_1_tribute) {
    const chests = Math.max(0, Math.floor(build.mythic_chests_owned || 0));
    const perChest =
      ex.cave_legendary_fish_tribute?.fragment_gain_percent_per_mythic_chest ??
      0.0025;
    mult *= 1 + perChest * chests;
  }

  if (build?.has_axolotl_skin_quest) {
    const level = Math.max(1, Math.floor(build.axolotl_skin_quest_level || 1));
    const perLevel =
      ex.axolotl_skin_quest?.fragment_gain_percent_per_level ??
      ex.axolotl_skin_quest?.fragment_gain_percent_per_rank ??
      0.03;
    mult *= 1 + perLevel * level;
  }

  return mult;
}

function computeCrosshairStats(build, lookup, sl) {
  const cross = lookup?.crosshairs || {};
  const luckPer =
    lookup?.stat_points?.stats?.luck?.per_point?.golden_crosshair_chance ??
    0.005;
  const divPer =
    lookup?.stat_points?.stats?.divinity?.per_point?.crosshair_auto_tap_chance ??
    0.02;
  return {
    crosshairSpawnChance: chance(cross.red?.spawn_chance ?? 0),
    goldenCrosshairChance: chance((sl.luck || 0) * luckPer),
    crosshairAutoTapChance: chance((sl.divinity || 0) * divPer),
    redCrosshairDamageMult: cross.red?.damage_multiplier ?? 1,
    goldenCrosshairDamageMult: cross.golden?.damage_multiplier ?? 3,
  };
}

/**
 * Global archaeology XP mult: (base/mythic) × (1 + INT×rate) × (1 + arch fragment %).
 * INT rate and arch upgrades are separate multiplicative factors, not one sum.
 */
function computeExpGainMult(build, lookup, up, sl, intBuffLv) {
  let xpMultBase = 1;
  if (up.archaeology_exp_gain_multiplier) {
    xpMultBase *= up.archaeology_exp_gain_multiplier;
  }
  const xpPerInt = 0.05 + intBuffLv * 0.01;
  const intMult = 1 + (sl.intellect || 0) * xpPerInt;
  const archMult = 1 + (up.archaeology_exp_gain_percent || 0);
  return xpMultBase * intMult * archMult;
}

/**
 * Fragment gain: additive PER/upgrades, then × one-time fragment_gain_multiplier (1.25).
 * Same stacking model as Other simulator.
 */
function computeFragmentGainMult(up, sl, build = null, lookup = null) {
  let fragMult =
    1 +
    (up.fragment_gain_percent || 0) +
    (sl.perception || 0) * 0.04;
  if (up.fragment_gain_multiplier) {
    fragMult *= up.fragment_gain_multiplier;
  }
  fragMult *= externalFragmentGainMultiplier(build, lookup);
  return fragMult;
}

/** Itemized normal (non-super) crit damage multiplier for tooltip checks. */
function computeCritDamageBreakdown(build, lookup) {
  const sl = build.stat_levels || {};
  const str = sl.strength || 0;
  const baseCrit = baseCritDamageMultFromLookup(lookup);
  const strCritPer =
    lookup?.stat_points?.stats?.strength?.per_point?.crit_damage_percent ?? 0.03;

  const lines = [{ label: "Base crit multiplier", amount: baseCrit, isBase: true }];
  if (str > 0) {
    const frac = str * strCritPer;
    lines.push({
      label: `Strength (${str} pts × ${(strCritPer * 100).toFixed(0)}% of base)`,
      displayFraction: frac,
      amount: baseCrit * frac,
    });
  }
  for (const u of upgradeEffectLines(build, lookup, "crit_damage_percent")) {
    const pctPerLv = u.perLevel * 100;
    const pctLabel = Number.isInteger(pctPerLv)
      ? `${pctPerLv}%`
      : `${pctPerLv.toFixed(1)}%`;
    lines.push({
      label: `${u.source} (lv ${u.level}, +${pctLabel}/lv of base)`,
      displayFraction: u.amount,
      amount: baseCrit * u.amount,
    });
  }
  const bonusFraction = lines
    .filter((l) => !l.isBase)
    .reduce((s, l) => s + (l.displayFraction ?? 0), 0);
  const multiplier = baseCrit * (1 + bonusFraction);
  return {
    lines,
    baseCrit,
    bonusFraction,
    bonusOnMult: baseCrit * bonusFraction,
    multiplier,
  };
}

function computeCombat(build, lookup) {
  const up = sumUpgradeEffects(build, lookup);
  const sl = build.stat_levels || {};
  const str = sl.strength || 0;
  const agi = sl.agility || 0;
  const cor = sl.corruption || 0;

  // strength_stat_buff totals already include level × per_level via sumUpgradeEffects
  const flatPerStr = 1 + (up.strength_flat_damage_bonus || 0);
  const pctPerStr = 0.01 + (up.strength_damage_percent_bonus || 0);

  let flat = baseDamageFromLookup(lookup);
  flat += up.flat_damage || 0;
  flat += str * flatPerStr;
  flat += (sl.divinity || 0) * 2;

  let damageMult = 1;
  damageMult += str * pctPerStr;
  damageMult += up.damage_percent || 0;
  damageMult += (sl.corruption || 0) * 0.06;

  let maxStamina = BASE_MAX_STAMINA;
  const staminaPerAgi = 5 + (up.agility_max_stamina_bonus || 0);
  maxStamina += agi * staminaPerAgi;
  maxStamina += up.max_stamina || 0;
  maxStamina += up.max_stamina_per_hit || 0;
  maxStamina *= 1 + (up.max_stamina_percent || 0);
  maxStamina *= 1 + cor * -0.03;

  const hs = build.highest_stage ?? 1;
  if (build.has_block_bonker) {
    damageMult *= 1 + 0.01 * hs;
    maxStamina *= 1 + 0.01 * hs;
  }

  let critChance = (up.crit_chance || 0) + agi * 0.01 + (sl.luck || 0) * 0.02;
  const baseCrit = baseCritDamageMultFromLookup(lookup);
  const bonusFrac = critDamageBonusFraction(build, lookup);
  const critDamageMultiplier = baseCrit * (1 + bonusFrac);
  const critDamageBonus = baseCrit * bonusFrac;

  const perBuffLv = build.upgrade_levels?.rare?.perception_stat_buff ?? 0;
  const flatPenBase =
    (up.flat_armor_penetration || 0) + (sl.perception || 0) * 2;
  const armorPenPctBonus =
    (sl.intellect || 0) * 0.03 +
    (up.armor_penetration_percent || 0) +
    perBuffLv * 0.01;
  const flatPen = flatPenBase * (1 + armorPenPctBonus);

  const totalDamage = Math.max(1, Math.round(flat * damageMult));
  const rawPerHit = totalDamage;

  const superCritChance =
    (up.super_crit_chance || 0) + (sl.divinity || 0) * 0.02;
  const ultraCritChance = up.ultra_crit_chance || 0;
  const { superCritDamageMult, ultraCritDamageMult } =
    superUltraCritDamageMults(up, lookup);
  const crosshairs = computeCrosshairStats(build, lookup, sl);

  const expectedDamage = Math.max(
    0.1,
    totalDamage * (1 - critChance + critChance * critDamageMultiplier),
  );

  return {
    flat,
    damageMult,
    totalDamage,
    rawPerHit,
    expectedDamage,
    maxStamina: Math.max(1, Math.floor(maxStamina)),
    flatPen,
    flatPenBase,
    armorPenPctBonus,
    critChance,
    critDamageBonus,
    critDamageMultiplier,
    superCritChance,
    superCritDamageMult,
    ultraCritChance,
    ultraCritDamageMult,
    ...crosshairs,
  };
}

/** Non-crit damage after armor (integer). MC uses rollHitDamage instead. */
function damageVsArmor(combat, blockArmor) {
  const armor = Math.max(0, blockArmor - combat.flatPen);
  const raw = combat.totalDamage ?? Math.max(1, Math.floor(combat.rawPerHit ?? 1));
  return Math.max(0, raw - armor);
}


function hitsToBreak(hp, damage) {
  if (damage <= 0) return Infinity;
  return Math.ceil(hp / damage);
}

/** Live combat / mod summary for verifying inputs against in-game tooltips. */
function computeBuildReport(build, lookup) {
  const up = sumUpgradeEffects(build, lookup);
  const sl = build.stat_levels || {};
  const combat = computeCombat(build, lookup);
  const bm = lookup.block_modifiers?.types || {};
  const timing = lookup.combat_timing?.attack_speed_multipliers || {};

  const agiBuffLv = build.upgrade_levels?.rare?.agility_stat_buff ?? 0;
  const perBuffLv = build.upgrade_levels?.rare?.perception_stat_buff ?? 0;
  const intBuffLv = build.upgrade_levels?.epic?.intellect_stat_buff ?? 0;

  const allModProc =
    (sl.luck || 0) * 0.002 + (up.all_mod_proc_chance_percent || 0);

  const critDamageMult =
    combat.critDamageMultiplier ??
    BASE_CRIT_DAMAGE_MULTIPLIER + (combat.critDamageBonus ?? 0);

  const superCritChance =
    (up.super_crit_chance || 0) + (sl.divinity || 0) * 0.02;
  const ultraCritChance = up.ultra_crit_chance || 0;
  const { superCritDamageMult: superCritDmgMult, ultraCritDamageMult: ultraCritDmgMult } =
    superUltraCritDamageMults(up, lookup);

  const modMagPct = (sl.corruption || 0) * 0.01;

  const expModBase = bm.experience?.base ?? 3;
  const expModMult =
    expModBase +
    (up.exp_mod_multiplier_gain || 0) +
    expModBase * modMagPct;

  const lootModBase = bm.loot?.base ?? 2;
  const lootModMult =
    lootModBase +
    (up.loot_mod_multiplier_gain || 0) +
    lootModBase * modMagPct;

  const speedHitsBase = bm.speed?.base_bonus_hits ?? 10;
  let speedModGain = speedHitsBase + (up.stamina_mod_gain || 0);
  if (build.has_block_bonker) {
    speedModGain += lookup.external_unlocks?.block_bonker?.effects_when_owned?.speed_mod_gain_bonus ?? 15;
  }

  const staminaModBase = bm.stamina?.base ?? 3;
  const staminaModGain =
    staminaModBase +
    (up.stamina_mod_gain || 0) +
    staminaModBase * modMagPct;

  const archExpMult = computeExpGainMult(build, lookup, up, sl, intBuffLv);
  const fragMult = computeFragmentGainMult(up, sl, build, lookup);
  const avada = avadaKedaEffects(build, lookup);

  const expModChance =
    (sl.intellect || 0) * 0.003 +
    (up.experience_mod_proc_chance || 0) +
    (up.exp_mod_proc_chance || 0) +
    intBuffLv * 0.0001 +
    allModProc;

  const lootModChance =
    (sl.perception || 0) * 0.003 +
    (up.loot_mod_proc_chance || 0) +
    (perBuffLv * 0.0001) +
    allModProc;

  const speedModChance =
    (sl.agility || 0) * 0.002 + allModProc;

  const staminaModChance =
    (up.stamina_mod_proc_chance || 0) +
    (up.agility_stamina_mod_proc_chance_bonus || 0) +
    allModProc;

  return {
    maxStamina: combat.maxStamina,
    damage: combat.rawPerHit ?? Math.round(combat.flat * combat.damageMult),
    avgDamage: combat.expectedDamage,
    flatPen: combat.flatPen,
    flatPenBase: combat.flatPenBase,
    armorPenPctBonus: combat.armorPenPctBonus,
    critChance: combat.critChance,
    critDamageMult,
    superCritChance,
    superCritDmgMult,
    ultraCritChance,
    ultraCritDmgMult,
    abilityInstacharge:
      (up.ability_instacharge_chance || 0) + avada.instachargeChance,
    crosshairSpawnChance: combat.crosshairSpawnChance,
    goldenCrosshairChance: combat.goldenCrosshairChance,
    crosshairAutoTapChance: combat.crosshairAutoTapChance,
    expGainMult: archExpMult,
    fragmentGainMult: fragMult,
    expModChance,
    expModGainMult: expModMult,
    lootModChance,
    lootModGainMult: lootModMult,
    speedModChance,
    speedModGainHits: speedModGain,
    speedModAtkRate: bm.speed?.attack_speed_multiplier ?? timing.speed_mod_active ?? 2,
    staminaModChance,
    staminaModGain: staminaModGain,
  };
}

/** XP sim economy (global mults + mod proc rates/magnitudes). */
function buildXpEconomy(build, lookup) {
  const r = computeBuildReport(build, lookup);
  const timing = lookup.combat_timing?.attack_speed_multipliers || {};
  return {
    expGainMult: r.expGainMult,
    expModGainMult: r.expModGainMult,
    expModChance: r.expModChance,
    speedModChance: r.speedModChance,
    speedModGainHits: r.speedModGainHits,
    speedAtkMult: timing.speed_mod_active ?? 2,
    flurryAtkMult: timing.flurry_active ?? 2,
    speedAndFlurryAtkMult: timing.speed_mod_and_flurry_together ?? 4,
    staminaModChance: r.staminaModChance,
    staminaModGain: r.staminaModGain,
  };
}

/** Fragment sim economy (fragment gain + loot mods + XP sim timing). */
function buildFragmentEconomy(build, lookup) {
  const xp = buildXpEconomy(build, lookup);
  const r = computeBuildReport(build, lookup);
  return {
    ...xp,
    fragmentGainMult: r.fragmentGainMult,
    lootModChance: r.lootModChance,
    lootModGainMult: r.lootModGainMult,
  };
}


return { baseDamageFromLookup, baseCritDamageMultFromLookup, baseUltraCritDamageMultFromLookup, sumUpgradeEffects, statCap, totalStatBudget, sumAllocated, clampStatLevels, upgradeEffectLines, critDamageBonusFraction, critDamageMultiplierFromBuild, superUltraCritDamageMults, chance, avadaKedaEffects, externalFragmentGainMultiplier, computeCrosshairStats, computeExpGainMult, computeFragmentGainMult, computeCritDamageBreakdown, computeCombat, damageVsArmor, hitsToBreak, computeBuildReport, buildXpEconomy, buildFragmentEconomy, BASE_DAMAGE, BASE_MAX_STAMINA, BASE_CRIT_DAMAGE_MULTIPLIER, BASE_ULTRA_CRIT_DAMAGE_MULTIPLIER, STAT_IDS };
})();
modules["cards"] = (function() {
/**
 * Block-tier cards: one quality per (family, tier). Higher tier replaces lower (no stacking).
 */

const CARD_FAMILIES = [
  "dirt",
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
  "divine",
];
const CARD_TIERS = [1, 2, 3, 4];
const CARD_QUALITIES = ["normal", "gilded", "polychrome"];
const MISC_CARD_QUALITIES = ["normal", "gilded", "polychrome"];

const QUALITY_RANK = { normal: 1, gilded: 2, polychrome: 3, infernal: 4 };

function cardKey(family, tier) {
  return `${family}_${tier}`;
}

function parseCardKey(key) {
  const m = /^(\w+)_([1-4])$/.exec(key);
  if (!m) return null;
  return { family: m[1], tier: parseInt(m[2], 10) };
}

/** Normalize saved card map — keep highest valid quality per key only. */
function normalizeBlockCards(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, val] of Object.entries(raw)) {
    const parsed = parseCardKey(key);
    if (!parsed || !CARD_FAMILIES.includes(parsed.family)) continue;
    const q = String(val || "").toLowerCase();
    if (!CARD_QUALITIES.includes(q)) continue;
    const prev = out[key];
    if (!prev || (QUALITY_RANK[q] ?? 0) > (QUALITY_RANK[prev] ?? 0)) {
      out[key] = q;
    }
  }
  return out;
}

function normalizeMiscCardQuality(raw) {
  if (!raw || raw === "none" || raw === "") return null;
  const q = String(raw).toLowerCase();
  return MISC_CARD_QUALITIES.includes(q) ? q : null;
}

function hasPolychromeCardUpgrade(build) {
  const lv =
    build.upgrade_levels?.common?.polychrome_archaeology_card_bonus ??
    build.levels?.polychrome_archaeology_card_bonus ??
    0;
  return lv > 0;
}

/** @param {object} build */
function buildCardContext(build, lookup) {
  return {
    cards: normalizeBlockCards(build.block_cards),
    polyUpgrade: hasPolychromeCardUpgrade(build),
    qualities: lookup.cards?.qualities || {},
  };
}

function qualityMultipliers(quality, ctx) {
  if (!quality || !ctx.qualities[quality]) {
    return { hpMult: 1, expLootMult: 1 };
  }
  const q = ctx.qualities[quality];
  let hpMult = q.block_hp_multiplier ?? 1;
  let expLootMult = q.exp_and_loot_multiplier ?? 1;
  if (quality === "polychrome" && ctx.polyUpgrade) {
    const max = q.max_with_polychrome_archaeology_card_upgrade;
    if (max) {
      hpMult = max.block_hp_multiplier ?? hpMult;
      expLootMult = max.exp_and_loot_multiplier ?? expLootMult;
    }
  }
  return { hpMult, expLootMult };
}

/** Buff for a spawned block from its family + tier number (1–4). */
function cardBuffForBlock(family, tierNum, cardCtx) {
  if (!CARD_FAMILIES.includes(family)) {
    return { hpMult: 1, expLootMult: 1, quality: null };
  }
  const quality = cardCtx.cards[cardKey(family, tierNum)] || null;
  const mult = qualityMultipliers(quality, cardCtx);
  return { ...mult, quality };
}

function tierAtStage(family, stage, lookup) {
  const tiers = lookup.blocks?.families?.[family]?.tiers;
  if (!tiers?.length) return { tier: 1 };
  let best = tiers[0];
  for (const t of tiers) {
    if (stage >= t.first_stage) best = t;
  }
  return best;
}

/** Block tier (1–4) each family uses at a given stage. */
function activeBlockTiersAtStage(stage, lookup) {
  const out = {};
  for (const family of CARD_FAMILIES) {
    out[family] = tierAtStage(family, stage, lookup).tier;
  }
  return out;
}

function getSpawnBand(stage, lookup) {
  for (const band of lookup.spawn_probabilities?.stage_bands || []) {
    const max = band.stage_max ?? Infinity;
    if (stage >= band.stage_min && stage <= max) return band;
  }
  const bands = lookup.spawn_probabilities?.stage_bands || [];
  return bands[bands.length - 1] || { percent: {} };
}

/**
 * How much of your farm-stage spawn pool has a matching card configured.
 * Cards apply to (family, tier) of the block at spawn — not “any tier for that family”.
 */
function cardCoverageAtStage(stage, lookup, cardCtx) {
  const band = getSpawnBand(stage, lookup);
  const tiersByFamily = activeBlockTiersAtStage(stage, lookup);
  let matchWeight = 0;
  let totalWeight = 0;
  let expLootWeighted = 0;

  for (const family of CARD_FAMILIES) {
    const pct = band.percent?.[family] ?? 0;
    if (pct <= 0) continue;
    totalWeight += pct;
    const tierNum = tiersByFamily[family];
    const buff = cardBuffForBlock(family, tierNum, cardCtx);
    expLootWeighted += pct * buff.expLootMult;
    if (buff.quality) matchWeight += pct;
  }

  return {
    stage,
    tiersByFamily,
    spawnMatchPct: totalWeight > 0 ? (matchWeight / totalWeight) * 100 : 0,
    avgExpLootMult: totalWeight > 0 ? expLootWeighted / totalWeight : 1,
    cardsConfigured: Object.keys(cardCtx.cards).length,
  };
}

function miscCardCooldownFactor(build, lookup) {
  const q = normalizeMiscCardQuality(build.misc_card_quality);
  if (!q) return 1;
  const table = lookup.cards?.archaeology_misc_card?.ability_cooldown_reduction;
  const reduction = table?.[q] ?? 0;
  return Math.max(0.05, 1 - reduction);
}

return { cardKey, parseCardKey, normalizeBlockCards, normalizeMiscCardQuality, hasPolychromeCardUpgrade, buildCardContext, qualityMultipliers, cardBuffForBlock, tierAtStage, activeBlockTiersAtStage, getSpawnBand, cardCoverageAtStage, miscCardCooldownFactor, CARD_FAMILIES, CARD_TIERS, CARD_QUALITIES, MISC_CARD_QUALITIES, QUALITY_RANK };
})();
modules["combat-abilities"] = (function() {
/**
 * Active skill runtime + per-hit damage rolls (crit / super / ultra / enrage).
 * Cooldowns are hit-based (1 hit = 1s at baseline attack speed).
 */

const { avadaKedaEffects, sumUpgradeEffects } = modules["build"];
const { miscCardCooldownFactor } = modules["cards"];
const DEFAULT_ABILITIES = { enrage: true, flurry: true, quake: true };

function normalizeAbilities(raw) {
  return {
    enrage: raw?.enrage !== false,
    flurry: raw?.flurry !== false,
    quake: raw?.quake !== false,
  };
}

/** @param {object} build */
function buildAbilityRuntime(build, lookup) {
  const up = sumUpgradeEffects(build, lookup);
  const enabled = normalizeAbilities(build.abilities);
  const skills = lookup.active_skills?.skills || {};
  const globalCd = up.all_ability_cooldown_attacks || 0;
  const avada = avadaKedaEffects(build, lookup);
  const miscCdFactor = miscCardCooldownFactor(build, lookup);

  function cooldownHits(base) {
    return Math.max(1, Math.round((base + globalCd) * miscCdFactor));
  }

  const enrageDef = skills.enrage || {};
  const flurryDef = skills.flurry || {};
  const quakeDef = skills.quake || {};
  const enrageAtk = enrageDef.per_attack_while_active || {};
  const quakeAtk = quakeDef.per_attack_while_active || {};
  const flurryCast = flurryDef.on_cast || {};
  const flurryStaminaBonus = up.flurry_stamina_on_cast || 0;

  return {
    enrage: {
      enabled: enabled.enrage,
      charges: (enrageDef.charges ?? 5) + avada.durationExtraHits,
      cooldownHits: cooldownHits(
        (enrageDef.cooldown_seconds ?? 60) +
          (up.enrage_cooldown_attacks || 0) +
          avada.cooldownAttacks,
      ),
      damagePercent:
        (enrageAtk.damage_percent ?? 0) + (up.enrage_damage_percent || 0),
      critDamagePercent:
        (enrageAtk.crit_damage_percent ?? 0) + (up.enrage_crit_damage_percent || 0),
    },
    flurry: {
      enabled: enabled.flurry,
      charges:
        (flurryDef.charges ?? 5) +
        flurryStaminaBonus +
        avada.flurrySpeedDurationExtraHits,
      cooldownHits: cooldownHits(
        (flurryDef.cooldown_seconds ?? 120) +
          (up.flurry_cooldown_attacks || 0) +
          avada.cooldownAttacks,
      ),
      staminaOnCast:
        (flurryCast.stamina_added ?? 5) +
        flurryStaminaBonus +
        avada.flurryStaminaOnCastExtra,
      speedMult:
        lookup.combat_timing?.attack_speed_multipliers?.flurry_active ?? 2,
    },
    quake: {
      enabled: enabled.quake,
      charges:
        (quakeDef.charges ?? 5) + (up.quake_attacks_per_activation || 0) +
        avada.durationExtraHits,
      cooldownHits: cooldownHits(
        (quakeDef.cooldown_seconds ?? 180) +
          (up.quake_cooldown_attacks || 0) +
          avada.cooldownAttacks,
      ),
      cleavePercent: quakeAtk.cleave_damage_percent_of_hit ?? 0.2,
    },
    instachargeChance:
      (up.ability_instacharge_chance || 0) + avada.instachargeChance,
  };
}

function effectiveArmor(combat, blockArmor) {
  return Math.max(0, blockArmor - combat.flatPen);
}

/** Integer damage before crits (matches in-game floor on total_damage). */
function integerRawDamage(combat) {
  return Math.max(1, Math.floor(combat.totalDamage ?? combat.rawPerHit ?? 1));
}

function baseDamageAfterArmor(combat, armor) {
  return Math.max(1, integerRawDamage(combat) - effectiveArmor(combat, armor));
}

/**
 * Crit mult for one hit. Enrage extra crit mult applies only when this hit crits.
 * Super/ultra only roll when base crit procs.
 */
function rollCritMultiplier(rng, combat, enrageActive, rt) {
  const critChance = Math.min(1, Math.max(0, combat.critChance ?? 0));
  if (rng() >= critChance) return 1;

  let mult = combat.critDamageMultiplier ?? 1.5;
  if (enrageActive && rt?.enrage?.enabled) {
    mult *= 1 + (rt.enrage.critDamagePercent ?? 0);
  }

  const superChance = Math.min(1, Math.max(0, combat.superCritChance ?? 0));
  if (superChance > 0 && rng() < superChance) {
    const ultraChance = Math.min(1, Math.max(0, combat.ultraCritChance ?? 0));
    if (ultraChance > 0 && rng() < ultraChance) {
      mult *= combat.ultraCritDamageMult ?? 3;
    } else {
      mult *= combat.superCritDamageMult ?? 2;
    }
  }
  return mult;
}

/** One attack on a block: enrage +20% dmg, then independent crit/super/ultra roll. */
function rollHitDamage(
  rng,
  combat,
  armor,
  rt,
  enrageActive,
  baseMultiplier = 1,
) {
  let base = baseDamageAfterArmor(combat, armor);
  base = Math.max(1, Math.floor(base * baseMultiplier));
  if (enrageActive && rt?.enrage?.enabled) {
    base = Math.max(1, Math.floor(base * (1 + (rt.enrage.damagePercent ?? 0))));
  }
  const critMult = rollCritMultiplier(rng, combat, enrageActive, rt);
  return Math.max(1, Math.floor(base * critMult));
}

/** Crosshair tap damage uses the same crit chain as a normal hit. */
function rollCrosshairDamage(
  rng,
  combat,
  armor,
  rt,
  enrageActive,
  baseMultiplier = 1,
) {
  return rollHitDamage(
    rng,
    combat,
    armor,
    rt,
    enrageActive,
    baseMultiplier,
  );
}

/** Quake splash: % of raw damage, ignores armor; each target rolls crit independently. */
function rollQuakeCleaveDamage(rng, combat, rt) {
  const pct = rt?.quake?.cleavePercent ?? 0.2;
  const base = Math.max(1, Math.floor(integerRawDamage(combat) * pct));
  const critMult = rollCritMultiplier(rng, combat, false, rt);
  return Math.max(1, Math.floor(base * critMult));
}

/** Random cooldown at run start so abilities don't all fire on hit 1. */
function randomAbilityCooldown(rng, maxHits) {
  const cap = Math.max(0, Math.floor(maxHits));
  if (cap <= 0) return 0;
  return Math.floor(rng() * cap);
}

function createRolledAbilityState(rt, rng) {
  return {
    enrage: {
      active: false,
      charges: 0,
      cooldown: randomAbilityCooldown(rng, rt.enrage.cooldownHits),
    },
    flurry: {
      cooldown: randomAbilityCooldown(rng, rt.flurry.cooldownHits),
      speedHits: 0,
    },
    quake: {
      active: false,
      charges: 0,
      cooldown: randomAbilityCooldown(rng, rt.quake.cooldownHits),
    },
    speedModHits: 0,
  };
}

/** @deprecated Use rollHitDamage in MC sims — expected damage inflates one-shot rates. */
function damageForHit(combat, armor, abilityRt, enrageActive) {
  let dmg = baseDamageAfterArmor(combat, armor);
  if (enrageActive && abilityRt?.enrage?.enabled) {
    dmg = Math.max(1, Math.floor(dmg * (1 + (abilityRt.enrage.damagePercent ?? 0))));
  }
  return dmg;
}


return { normalizeAbilities, buildAbilityRuntime, effectiveArmor, integerRawDamage, baseDamageAfterArmor, rollCritMultiplier, rollHitDamage, rollCrosshairDamage, rollQuakeCleaveDamage, randomAbilityCooldown, createRolledAbilityState, damageForHit, DEFAULT_ABILITIES };
})();
modules["stage-cache"] = (function() {
/**
 * Precomputed per-stage spawn tables (lookup + cardCtx constant for an optimizer batch).
 * RNG-dependent parts (slot rolls, block mods) still happen at runtime.
 */

const { buildCardContext } = modules["cards"];
const FAMILIES = ["dirt", "common", "rare", "epic", "legendary", "mythic"];

/** Stage layouts for a build — invariant when only stat_levels change in a batch. */
function createSharedStageLayout(
  build,
  lookup,
  cardBuffForBlock,
  maxStage = 200,
) {
  const cardCtx = buildCardContext(build, lookup);
  return {
    cardCtx,
    stageCache: buildStageCache(lookup, cardCtx, cardBuffForBlock, maxStage),
  };
}

function getSpawnBand(stage, lookup) {
  for (const band of lookup.spawn_probabilities.stage_bands) {
    const max = band.stage_max ?? Infinity;
    if (stage >= band.stage_min && stage <= max) return band;
  }
  const bands = lookup.spawn_probabilities.stage_bands;
  return bands[bands.length - 1];
}

function stageScale(stage, lookup, kind) {
  const ss = lookup.blocks.stage_scaling;
  const arr =
    kind === "hp"
      ? ss.hp_multiplier_per_milestone
      : ss.armor_multiplier_per_milestone;
  let m = 1;
  for (let i = 0; i < ss.milestone_stages.length; i++) {
    if (stage >= ss.milestone_stages[i]) m *= arr[i];
  }
  return m;
}

function tierAtStage(family, stage, lookup) {
  const tiers = lookup.blocks.families[family].tiers;
  let best = tiers[0];
  for (const t of tiers) {
    if (stage >= t.first_stage) best = t;
  }
  return best;
}

function bossLayout(stage, lookup) {
  return lookup.boss_stages.stages[String(stage)] || null;
}

function scaledBlockStats(family, tier, hpM, arM, cardCtx, cardBuffForBlock) {
  const buff = cardBuffForBlock(family, tier.tier, cardCtx);
  const baseFrag = tier.fragments ?? 0;
  return {
    hp: tier.hp * hpM * buff.hpMult,
    armor: tier.armor * arM,
    exp: tier.exp * buff.expLootMult,
    fragments: baseFrag > 0 ? baseFrag * buff.expLootMult : 0,
    tierNum: tier.tier,
  };
}

/** @typedef {{ family: string, hp: number, armor: number, exp: number, fragments: number, tierNum: number }} BlockTemplate */

/**
 * @param {object} lookup
 * @param {object} cardCtx
 * @param {function} cardBuffForBlock — from cards.js (injected to avoid circular imports)
 * @param {number} [maxStage]
 */
function buildStageCache(lookup, cardCtx, cardBuffForBlock, maxStage = 200) {
  const gridSlots = lookup.boss_stages.grid_slots ?? 24;
  const cache = new Array(maxStage + 1);

  for (let stage = 1; stage <= maxStage; stage++) {
    const hpM = stageScale(stage, lookup, "hp");
    const arM = stageScale(stage, lookup, "armor");
    const boss = bossLayout(stage, lookup);

    if (boss) {
      /** @type {BlockTemplate[]} */
      const bossBlocks = [];
      for (const [fam, count] of Object.entries(boss)) {
        const tier = tierAtStage(fam, stage, lookup);
        const stats = scaledBlockStats(fam, tier, hpM, arM, cardCtx, cardBuffForBlock);
        for (let i = 0; i < count; i++) {
          bossBlocks.push({ family: fam, ...stats });
        }
      }
      cache[stage] = { stage, gridSlots, bossBlocks };
      continue;
    }

    const band = getSpawnBand(stage, lookup);
    const perc = band.percent || {};
    const cdf = [];
    let totalWeight = 0;
    for (const family of FAMILIES) {
      const weight = perc[family] ?? 0;
      if (weight > 0) {
        totalWeight += weight;
        cdf.push({ family, acc: totalWeight });
      }
    }

    const familyStats = {};
    for (const family of FAMILIES) {
      if (perc[family] == null) continue;
      const tier = tierAtStage(family, stage, lookup);
      familyStats[family] = scaledBlockStats(
        family,
        tier,
        hpM,
        arM,
        cardCtx,
        cardBuffForBlock,
      );
    }

    cache[stage] = {
      stage,
      gridSlots,
      bossBlocks: null,
      emptyChance: Math.max(0, 100 - totalWeight) / 100,
      totalWeight,
      cdf,
      familyStats,
    };
  }

  return cache;
}

/** Roll a family from a precomputed normal-floor entry; null = empty slot. */
function rollFamilyFromCache(rng, entry) {
  if (!entry || entry.bossBlocks) return null;
  if (entry.totalWeight <= 0) return null;
  if (rng() < entry.emptyChance) return null;
  const r = rng() * entry.totalWeight;
  for (const row of entry.cdf) {
    if (r <= row.acc) return row.family;
  }
  return entry.cdf.length ? entry.cdf[entry.cdf.length - 1].family : null;
}

function getStageCacheEntry(stageCache, stage) {
  if (!stageCache) return null;
  return stageCache[stage] ?? null;
}

return { createSharedStageLayout, getSpawnBand, stageScale, tierAtStage, bossLayout, scaledBlockStats, buildStageCache, rollFamilyFromCache, getStageCacheEntry, FAMILIES };
})();
modules["sim"] = (function() {
/**
 * Monte Carlo run simulator — maximize depth (push) and XP/hr.
 * Spawn-order targeting; rolled crits; partial floor credit when stamina runs out.
 */

const { buildFragmentEconomy, buildXpEconomy, computeCombat } = modules["build"];
const { buildCardContext, cardBuffForBlock } = modules["cards"];
const {
  buildAbilityRuntime,
  baseDamageAfterArmor,
  createRolledAbilityState,
  rollCrosshairDamage,
  rollHitDamage,
  rollQuakeCleaveDamage,
} = modules["combat-abilities"];
const {
  buildStageCache,
  createSharedStageLayout,
  getStageCacheEntry,
  rollFamilyFromCache,
} = modules["stage-cache"];
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBlock(family, hp, armor, tierNum = null) {
  return {
    family,
    tier: tierNum,
    hp,
    armor,
    remainingHp: hp,
    initialHp: hp,
  };
}

function stampInitialHp(blocks) {
  for (const b of blocks) {
    b.initialHp = b.remainingHp;
  }
}

/** Fraction of current stage HP removed (0–1) for partial floor credit. */
function stageClearFraction(blocks) {
  let total = 0;
  let cleared = 0;
  for (const b of blocks) {
    const init = b.initialHp ?? b.hp ?? b.remainingHp;
    total += init;
    cleared += Math.max(0, init - b.remainingHp);
  }
  return total > 0 ? Math.min(1, cleared / total) : 1;
}

function makeBlocks(stage, rng, stageCache) {
  const entry = getStageCacheEntry(stageCache, stage);
  const blocks = [];

  if (!entry) return blocks;

  if (entry.bossBlocks) {
    for (const t of entry.bossBlocks) {
      blocks.push(makeBlock(t.family, t.hp, t.armor, t.tierNum));
    }
  } else {
    for (let i = 0; i < entry.gridSlots; i++) {
      const fam = rollFamilyFromCache(rng, entry);
      if (!fam) continue;
      const stats = entry.familyStats[fam];
      blocks.push(makeBlock(fam, stats.hp, stats.armor, stats.tierNum));
    }
  }

  stampInitialHp(blocks);
  return blocks;
}

function createBlockRunState(blocks) {
  return {
    blocks,
    targetIdx: 0,
    alive: blocks.length,
    broken: [],
  };
}

function currentTarget(run) {
  while (
    run.targetIdx < run.blocks.length &&
    run.blocks[run.targetIdx].remainingHp <= 0
  ) {
    run.targetIdx++;
  }
  return run.blocks[run.targetIdx] ?? null;
}

/** Apply damage; queue newly broken blocks for reward processing. */
function damageBlock(run, block, dmg) {
  if (block.remainingHp <= 0) return false;
  block.remainingHp = Math.max(0, block.remainingHp - dmg);
  if (block.remainingHp === 0) {
    run.alive--;
    run.broken.push(block);
    return true;
  }
  return false;
}

function createAbilityState(rt, rng) {
  const ab = createRolledAbilityState(rt, rng);
  return {
    enrage: ab.enrage,
    flurry: { cooldown: ab.flurry.cooldown },
    quake: ab.quake,
  };
}

function tickCooldowns(ab) {
  if (ab.enrage.cooldown > 0) ab.enrage.cooldown--;
  if (ab.flurry.cooldown > 0) ab.flurry.cooldown--;
  if (ab.quake.cooldown > 0) ab.quake.cooldown--;
}

function tryCastAbilities(ab, rt, staminaRef, maxStamina, rng) {
  if (rt.enrage.enabled && !ab.enrage.active && ab.enrage.cooldown <= 0) {
    ab.enrage.active = true;
    ab.enrage.charges = rt.enrage.charges * instachargeCasts(rt, rng);
    ab.enrage.cooldown = rt.enrage.cooldownHits;
  }
  if (rt.flurry.enabled && ab.flurry.cooldown <= 0) {
    staminaRef.current = Math.min(
      maxStamina,
      staminaRef.current + rt.flurry.staminaOnCast * instachargeCasts(rt, rng),
    );
    ab.flurry.cooldown = rt.flurry.cooldownHits;
  }
  if (rt.quake.enabled && !ab.quake.active && ab.quake.cooldown <= 0) {
    ab.quake.active = true;
    ab.quake.charges = rt.quake.charges * instachargeCasts(rt, rng);
    ab.quake.cooldown = rt.quake.cooldownHits;
  }
}

function attacksPerStamina() {
  return 1;
}

function clampChance(v) {
  return Math.min(1, Math.max(0, v || 0));
}

function instachargeCasts(rt, rng) {
  const chance = clampChance(rt.instachargeChance);
  if (chance <= 0 || !rng || rng() >= chance) return 1;
  return 2;
}

function createCrosshairTimerState() {
  return { nextAt: 1 };
}

function attackTimeSlice(mult) {
  return 1 / Math.max(1, mult || 1);
}

function initTrackedSecondTimer(ab) {
  if (!Number.isFinite(ab.secondProgress)) ab.secondProgress = 0;
  if (!Number.isFinite(ab.secondAttackCount)) ab.secondAttackCount = 0;
}

function decrementTimedAbilityCooldowns(ab) {
  if (ab.enrage.cooldown > 0) ab.enrage.cooldown--;
  if (ab.flurry.cooldown > 0) ab.flurry.cooldown--;
  if (ab.quake.cooldown > 0) ab.quake.cooldown--;
}

function advanceTrackedSecondTimer(ab, attackMult) {
  initTrackedSecondTimer(ab);
  ab.secondProgress += attackTimeSlice(attackMult);
  ab.secondAttackCount++;

  let ticked = false;
  while (ab.secondProgress >= 1 - 1e-9) {
    const elapsedAttackCount = Math.max(1, ab.secondAttackCount);
    decrementTimedAbilityCooldowns(ab);
    if (ab.flurry.speedHits > 0) {
      ab.flurry.speedHits = Math.max(0, ab.flurry.speedHits - elapsedAttackCount);
    }
    ab.secondProgress -= 1;
    if (ab.secondProgress < 1e-9) ab.secondProgress = 0;
    ab.secondAttackCount = 0;
    ticked = true;
  }
  return ticked;
}

function markInstantAttackOnSpeedIncrease(ab, economy, beforeMult) {
  if (attackSpeedMult(ab, economy) > beforeMult) {
    ab.instantAttackPending = true;
  }
}

function rollCrosshairTapMultiplier(combat, rng) {
  const goldenChance = clampChance(combat.goldenCrosshairChance);
  if (goldenChance > 0 && rng() < goldenChance) {
    return combat.goldenCrosshairDamageMult ?? 3;
  }
  return combat.redCrosshairDamageMult ?? 1;
}

function rollAutoCrosshairMultiplier(combat, rng) {
  const autoTap = clampChance(combat.crosshairAutoTapChance);
  if (autoTap <= 0 || rng() >= autoTap) return 0;
  return rollCrosshairTapMultiplier(combat, rng);
}

function applyAutoCrosshair(run, target, combat, rt, enrageOn, rng) {
  if (!target || target.remainingHp <= 0) return false;
  const spawn = clampChance(combat.crosshairSpawnChance);
  if (spawn <= 0 || rng() >= spawn) return false;
  const mult = rollAutoCrosshairMultiplier(combat, rng);
  if (mult <= 0) return false;
  damageBlock(
    run,
    target,
    rollCrosshairDamage(rng, combat, target.armor, rt, enrageOn, mult),
  );
  return true;
}

function applyAutoCrosshairToCurrent(run, combat, rt, ab, rng) {
  const target = currentTarget(run);
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  return applyAutoCrosshair(run, target, combat, rt, enrageOn, rng);
}

function applyAutoCrosshairsToAlive(run, combat, rt, ab, rng) {
  const spawn = clampChance(combat.crosshairSpawnChance);
  const autoTap = clampChance(combat.crosshairAutoTapChance);
  if (spawn <= 0 || autoTap <= 0) return 0;
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  let hits = 0;
  for (const block of run.blocks) {
    if (block.remainingHp <= 0) continue;
    if (applyAutoCrosshair(run, block, combat, rt, enrageOn, rng)) hits++;
  }
  return hits;
}

function applyCrosshairTimerTicks(run, combat, rt, ab, rng, timer, from, to) {
  if (!timer) return 0;
  let ticks = 0;
  const end = to + 1e-9;
  while (timer.nextAt <= end) {
    applyAutoCrosshairsToAlive(run, combat, rt, ab, rng);
    timer.nextAt += 1;
    ticks++;
  }
  return ticks;
}

function applyQuakeCleave(run, target, combat, rt, ab, rng) {
  if (!ab.quake.active || !rt.quake.enabled || ab.quake.charges <= 0) return;
  for (const b of run.blocks) {
    if (b === target || b.remainingHp <= 0) continue;
    damageBlock(run, b, rollQuakeCleaveDamage(rng, combat, rt));
  }
  ab.quake.charges--;
  if (ab.quake.charges <= 0) {
    ab.quake.active = false;
  }
}

function performHit(run, combat, rt, ab, rng) {
  const target = currentTarget(run);
  if (!target) return false;

  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  damageBlock(
    run,
    target,
    rollHitDamage(rng, combat, target.armor, rt, enrageOn),
  );
  applyQuakeCleave(run, target, combat, rt, ab, rng);

  if (enrageOn) {
    ab.enrage.charges--;
    if (ab.enrage.charges <= 0) {
      ab.enrage.active = false;
    }
  }

  return true;
}

function resolveMaxStage(stage, maxStage, blocks, staminaLeft, aliveCount) {
  const alive =
    aliveCount ?? blocks.filter((b) => b.remainingHp > 0).length;
  if (staminaLeft > 0 && alive === 0) return maxStage;
  if (staminaLeft <= 0 && alive > 0) {
    const partial = (stage - 1) + stageClearFraction(blocks);
    return Math.max(maxStage, partial);
  }
  return maxStage;
}

/** Cached combat/abilities/cards/stages for many MC trials on one build. */
function createPushRunContext(build, lookup, sharedLayout = null) {
  const layout =
    sharedLayout ?? createSharedStageLayout(build, lookup, cardBuffForBlock);
  return {
    combat: computeCombat(build, lookup),
    rt: buildAbilityRuntime(build, lookup),
    cardCtx: layout.cardCtx,
    stageCache: layout.stageCache,
  };
}

/** One run; returns max stage reached. */
function simulateRun(build, lookup, rng, ctx) {
  const runCtx = ctx ?? createPushRunContext(build, lookup);
  const { combat, rt, stageCache } = runCtx;
  const ab = createAbilityState(rt, rng);
  const staminaRef = { current: combat.maxStamina };

  let stamina = staminaRef.current;
  let stage = 1;
  let maxStage = 1;
  let elapsed = 0;
  const crosshairTimer = createCrosshairTimerState();
  let blockRun = createBlockRunState(makeBlocks(stage, rng, stageCache));

  while (stamina > 0) {
    if (blockRun.alive === 0) {
      stage += 1;
      maxStage = Math.max(maxStage, stage);
      if (stage > 200) break;
      blockRun = createBlockRunState(makeBlocks(stage, rng, stageCache));
      continue;
    }

    tickCooldowns(ab);
    staminaRef.current = stamina;
    tryCastAbilities(ab, rt, staminaRef, combat.maxStamina, rng);
    stamina = staminaRef.current;

    const nAtk = attacksPerStamina();
    let hitDone = false;
    for (let i = 0; i < nAtk && stamina > 0; i++) {
      if (performHit(blockRun, combat, rt, ab, rng)) {
        hitDone = true;
        const nextElapsed = elapsed + 1;
        applyCrosshairTimerTicks(
          blockRun,
          combat,
          rt,
          ab,
          rng,
          crosshairTimer,
          elapsed,
          nextElapsed,
        );
        elapsed = nextElapsed;
      } else {
        break;
      }
    }

    if (!hitDone) break;
    stamina -= 1;
  }

  return resolveMaxStage(
    stage,
    maxStage,
    blockRun.blocks,
    stamina,
    blockRun.alive,
  );
}

function runMonteCarlo(
  build,
  lookup,
  { trials = 800, seed = 1, scoreOnly = false } = {},
  sharedLayout = null,
) {
  const rng = mulberry32(seed);
  const ctx = createPushRunContext(build, lookup, sharedLayout);
  const hist = scoreOnly ? null : new Map();
  let sum = 0;
  for (let i = 0; i < trials; i++) {
    const s = simulateRun(build, lookup, rng, ctx);
    sum += s;
    if (hist) hist.set(s, (hist.get(s) || 0) + 1);
  }
  const mean = sum / trials;
  if (scoreOnly) {
    return { mean, trials };
  }
  const sorted = [...hist.keys()].sort((a, b) => a - b);
  const percentile = (p) => {
    const target = p * trials;
    let acc = 0;
    for (const s of sorted) {
      acc += hist.get(s);
      if (acc >= target) return s;
    }
    return sorted.length ? sorted[sorted.length - 1] : 0;
  };
  const percentiles = { 0.5: percentile(0.5), 0.9: percentile(0.9), 0.95: percentile(0.95) };
  return { mean, hist, percentiles, trials };
}

function createManualPushAbilityState(rt) {
  const ab = createRolledAbilityState(rt, () => 0);
  ab.enrage.cooldown = 0;
  ab.flurry.cooldown = 0;
  ab.quake.cooldown = 0;
  return ab;
}

function expectedFilledSlots(entry) {
  if (!entry) return 0;
  if (entry.bossBlocks) return entry.bossBlocks.length;
  return (entry.gridSlots ?? 24) * (1 - (entry.emptyChance ?? 0));
}

function buildExpectedFilledSlotCache(stageCache, maxStage = 200) {
  const out = new Array(maxStage + 1);
  for (let stage = 1; stage <= maxStage; stage++) {
    out[stage] = expectedFilledSlots(getStageCacheEntry(stageCache, stage));
  }
  return out;
}

function castManualEnrage(ab, rt, rng) {
  if (!rt.enrage.enabled || ab.enrage.active || ab.enrage.cooldown > 0) {
    return false;
  }
  ab.enrage.active = true;
  ab.enrage.charges = rt.enrage.charges * instachargeCasts(rt, rng);
  ab.enrage.cooldown = rt.enrage.cooldownHits;
  return true;
}

function castManualFlurry(ab, rt, staminaRef, maxStamina, rng, economy) {
  if (!rt.flurry.enabled || ab.flurry.cooldown > 0) return false;
  const missing = maxStamina - staminaRef.current;
  if (missing < rt.flurry.staminaOnCast) return false;
  const beforeMult = attackSpeedMult(ab, economy);
  const casts = instachargeCasts(rt, rng);
  staminaRef.current = Math.min(
    maxStamina,
    staminaRef.current + rt.flurry.staminaOnCast * casts,
  );
  ab.flurry.cooldown = rt.flurry.cooldownHits;
  ab.flurry.speedHits += rt.flurry.charges * casts;
  markInstantAttackOnSpeedIncrease(ab, economy, beforeMult);
  return true;
}

function castManualQuake(ab, rt, rng) {
  if (!rt.quake.enabled || ab.quake.active || ab.quake.cooldown > 0) {
    return false;
  }
  ab.quake.active = true;
  ab.quake.charges = rt.quake.charges * instachargeCasts(rt, rng);
  ab.quake.cooldown = rt.quake.cooldownHits;
  return true;
}

function knownRemainingStaminaGain(run, economy) {
  let gain = 0;
  for (const block of run.blocks) {
    if (
      block.remainingHp > 0 &&
      block.mods?.stamina &&
      !block.manualRewardsAwarded
    ) {
      gain += economy.staminaModGain;
    }
  }
  return gain;
}

function estimatedHitsToClearCurrentStage(run, combat) {
  let hits = 0;
  for (const block of run.blocks) {
    if (block.remainingHp <= 0) continue;
    const dmg = baseDamageAfterArmor(combat, block.armor);
    hits += Math.ceil(block.remainingHp / Math.max(1, dmg));
  }
  return hits;
}

function cannotClearCurrentStageWithQuakeReserve(stamina, run, combat, economy) {
  const staminaAvailable = stamina + knownRemainingStaminaGain(run, economy);
  return staminaAvailable < estimatedHitsToClearCurrentStage(run, combat) + 5;
}

function shouldManualQuake(stageFresh, run, expectedFilled, stamina, combat, economy) {
  if (cannotClearCurrentStageWithQuakeReserve(stamina, run, combat, economy)) {
    return true;
  }
  if (stageFresh) return true;
  return run.alive > expectedFilled;
}

function tryCastManualPushAbilities(
  ab,
  rt,
  staminaRef,
  maxStamina,
  rng,
  economy,
  run,
  stageFresh,
  expectedFilled,
  combat,
) {
  const enrageThreshold = 0.2 * Math.max(1, rt.enrage.cooldownHits || 1);
  const enrageFast =
    rt.enrage.enabled &&
    rt.quake.enabled &&
    rt.enrage.cooldownHits <= rt.quake.cooldownHits / 2;

  if (enrageFast) {
    castManualEnrage(ab, rt, rng);
  } else if (
    rt.enrage.enabled &&
    !ab.enrage.active &&
    ab.enrage.cooldown <= 0 &&
    ab.quake.cooldown > enrageThreshold
  ) {
    castManualEnrage(ab, rt, rng);
  }

  const quakeReady =
    rt.quake.enabled && !ab.quake.active && ab.quake.cooldown <= 0;
  const emergency = cannotClearCurrentStageWithQuakeReserve(
    staminaRef.current,
    run,
    combat,
    economy,
  );
  if (
    quakeReady &&
    shouldManualQuake(
      stageFresh,
      run,
      expectedFilled,
      staminaRef.current,
      combat,
      economy,
    )
  ) {
    if (rt.enrage.enabled && !ab.enrage.active) {
      if (ab.enrage.cooldown <= 0) {
        castManualEnrage(ab, rt, rng);
      } else if (!emergency && ab.enrage.cooldown <= enrageThreshold) {
        castManualFlurry(ab, rt, staminaRef, maxStamina, rng, economy);
        return;
      }
    }
    castManualQuake(ab, rt, rng);
  }

  castManualFlurry(ab, rt, staminaRef, maxStamina, rng, economy);
}

function rollManualCrosshairMultiplier(combat, rng) {
  return rollCrosshairTapMultiplier(combat, rng);
}

function applyManualCrosshair(run, target, combat, rt, enrageOn, rng) {
  if (!target || target.remainingHp <= 0) return false;
  const spawn = clampChance(combat.crosshairSpawnChance);
  if (spawn <= 0 || rng() >= spawn) return false;
  const mult = rollManualCrosshairMultiplier(combat, rng);
  if (mult <= 0) return false;
  damageBlock(
    run,
    target,
    rollCrosshairDamage(rng, combat, target.armor, rt, enrageOn, mult),
  );
  return true;
}

function drainBrokenManual(run, economy, staminaRef, maxStamina) {
  while (run.broken.length) {
    const b = run.broken.pop();
    if (b.remainingHp > 0 || b.manualRewardsAwarded) continue;
    b.manualRewardsAwarded = true;
    if (b.mods?.stamina) {
      staminaRef.current = Math.min(
        maxStamina,
        staminaRef.current + economy.staminaModGain,
      );
    }
  }
}

function applyManualCrosshairToCurrent(
  run,
  combat,
  rt,
  ab,
  economy,
  staminaRef,
  maxStamina,
  rng,
) {
  const target = currentTarget(run);
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  const hit = applyManualCrosshair(run, target, combat, rt, enrageOn, rng);
  if (hit) drainBrokenManual(run, economy, staminaRef, maxStamina);
  return hit;
}

function applyManualCrosshairsToAlive(
  run,
  combat,
  rt,
  ab,
  economy,
  staminaRef,
  maxStamina,
  rng,
) {
  const spawn = clampChance(combat.crosshairSpawnChance);
  if (spawn <= 0) return 0;
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  let hits = 0;
  for (const block of run.blocks) {
    if (block.remainingHp <= 0) continue;
    if (applyManualCrosshair(run, block, combat, rt, enrageOn, rng)) {
      hits++;
      drainBrokenManual(run, economy, staminaRef, maxStamina);
    }
  }
  return hits;
}

function applyManualCrosshairTimerTicks(
  run,
  combat,
  rt,
  ab,
  economy,
  staminaRef,
  maxStamina,
  rng,
  timer,
  from,
  to,
) {
  if (!timer) return 0;
  let ticks = 0;
  const end = to + 1e-9;
  while (timer.nextAt <= end) {
    applyManualCrosshairsToAlive(
      run,
      combat,
      rt,
      ab,
      economy,
      staminaRef,
      maxStamina,
      rng,
    );
    timer.nextAt += 1;
    ticks++;
  }
  return ticks;
}

function performManualPushHit(
  run,
  combat,
  rt,
  ab,
  economy,
  staminaRef,
  maxStamina,
  rng,
) {
  const target = currentTarget(run);
  if (!target) return { hit: false, seconds: 0 };

  const attackMultForHit = attackSpeedMult(ab, economy);
  const instant = ab.instantAttackPending === true;
  ab.instantAttackPending = false;
  const { speedBefore } = onHitBlock(target, ab, economy);
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  damageBlock(
    run,
    target,
    rollHitDamage(rng, combat, target.armor, rt, enrageOn),
  );
  applyQuakeCleave(run, target, combat, rt, ab, rng);

  if (enrageOn) {
    ab.enrage.charges--;
    if (ab.enrage.charges <= 0) {
      ab.enrage.active = false;
    }
  }

  drainBrokenManual(run, economy, staminaRef, maxStamina);
  const seconds = instant ? 0 : attackTimeSlice(attackMultForHit);
  if (speedBefore > 0 && ab.speedModHits > 0) ab.speedModHits--;
  advanceTrackedSecondTimer(ab, attackMultForHit);

  return { hit: true, seconds };
}

/** Cached combat/economy/stages for manual push MC trials on one build. */
function createManualPushRunContext(build, lookup, sharedLayout = null) {
  const layout =
    sharedLayout ?? createSharedStageLayout(build, lookup, cardBuffForBlock);
  return {
    combat: computeCombat(build, lookup),
    rt: buildAbilityRuntime(build, lookup),
    economy: buildXpEconomy(build, lookup),
    cardCtx: layout.cardCtx,
    stageCache: layout.stageCache,
    expectedFilledByStage: buildExpectedFilledSlotCache(layout.stageCache),
  };
}

/** One manual push run; returns max stage reached and elapsed combat seconds. */
function simulateManualPushRun(build, lookup, rng, ctx) {
  const runCtx = ctx ?? createManualPushRunContext(build, lookup);
  const { combat, rt, economy, stageCache, expectedFilledByStage } = runCtx;
  const ab = createManualPushAbilityState(rt);
  const staminaRef = { current: combat.maxStamina };

  let stamina = staminaRef.current;
  let stage = 1;
  let maxStage = 1;
  let elapsed = 0;
  let stageFresh = true;
  const crosshairTimer = createCrosshairTimerState();
  let blockRun = createBlockRunState(makeXpBlocks(stage, rng, stageCache, economy));

  while (stamina > 0) {
    if (blockRun.alive === 0) {
      stage += 1;
      maxStage = Math.max(maxStage, stage);
      if (stage > 200) break;
      blockRun = createBlockRunState(makeXpBlocks(stage, rng, stageCache, economy));
      stageFresh = true;
      continue;
    }

    staminaRef.current = stamina;
    tryCastManualPushAbilities(
      ab,
      rt,
      staminaRef,
      combat.maxStamina,
      rng,
      economy,
      blockRun,
      stageFresh,
      expectedFilledByStage[stage] ?? expectedFilledSlots(getStageCacheEntry(stageCache, stage)),
      combat,
    );
    stamina = staminaRef.current;

    const result = performManualPushHit(
      blockRun,
      combat,
      rt,
      ab,
      economy,
      staminaRef,
      combat.maxStamina,
      rng,
    );
    if (!result.hit) break;

    const nextElapsed = elapsed + result.seconds;
    applyManualCrosshairTimerTicks(
      blockRun,
      combat,
      rt,
      ab,
      economy,
      staminaRef,
      combat.maxStamina,
      rng,
      crosshairTimer,
      elapsed,
      nextElapsed,
    );
    elapsed = nextElapsed;
    stamina = staminaRef.current;
    stamina -= 1;
    stageFresh = false;
  }

  maxStage = resolveMaxStage(
    stage,
    maxStage,
    blockRun.blocks,
    stamina,
    blockRun.alive,
  );
  return { maxStage, seconds: elapsed };
}

function runManualPushMonteCarlo(
  build,
  lookup,
  { trials = 800, seed = 1, scoreOnly = false } = {},
  sharedLayout = null,
) {
  const rng = mulberry32(seed);
  const ctx = createManualPushRunContext(build, lookup, sharedLayout);
  const hist = scoreOnly ? null : new Map();
  let sum = 0;
  let sumSeconds = 0;
  for (let i = 0; i < trials; i++) {
    const r = simulateManualPushRun(build, lookup, rng, ctx);
    sum += r.maxStage;
    sumSeconds += r.seconds;
    if (hist) hist.set(r.maxStage, (hist.get(r.maxStage) || 0) + 1);
  }
  const mean = sum / trials;
  const meanSeconds = sumSeconds / trials;
  if (scoreOnly) {
    return { mean, meanSeconds, trials, engine: "manual" };
  }
  const sorted = [...hist.keys()].sort((a, b) => a - b);
  const percentile = (p) => {
    const target = p * trials;
    let acc = 0;
    for (const s of sorted) {
      acc += hist.get(s);
      if (acc >= target) return s;
    }
    return sorted.length ? sorted[sorted.length - 1] : 0;
  };
  const percentiles = { 0.5: percentile(0.5), 0.9: percentile(0.9), 0.95: percentile(0.95) };
  return { mean, meanSeconds, hist, percentiles, trials, engine: "manual" };
}

function rollBlockMods(rng, economy) {
  const mods = {};
  if (rng() < economy.expModChance) mods.exp = true;
  if (rng() < economy.speedModChance) mods.speed = true;
  if (rng() < economy.staminaModChance) mods.stamina = true;
  return mods;
}

function makeXpBlock(family, hp, armor, baseExp, mods, tierNum = null) {
  return {
    family,
    tier: tierNum,
    hp,
    armor,
    remainingHp: hp,
    baseExp,
    mods,
    xpAwarded: false,
    speedModApplied: false,
    initialHp: hp,
  };
}

function makeXpBlocks(stage, rng, stageCache, economy) {
  const entry = getStageCacheEntry(stageCache, stage);
  const blocks = [];
  if (!entry) return blocks;

  const pushFromTemplate = (t) => {
    blocks.push(
      makeXpBlock(
        t.family,
        t.hp,
        t.armor,
        t.exp,
        rollBlockMods(rng, economy),
        t.tierNum,
      ),
    );
  };

  if (entry.bossBlocks) {
    for (const t of entry.bossBlocks) pushFromTemplate(t);
  } else {
    for (let i = 0; i < entry.gridSlots; i++) {
      const fam = rollFamilyFromCache(rng, entry);
      if (!fam) continue;
      pushFromTemplate({ family: fam, ...entry.familyStats[fam] });
    }
  }

  stampInitialHp(blocks);
  return blocks;
}

function createXpAbilityState(rt, rng) {
  return createRolledAbilityState(rt, rng);
}

function attackSpeedMult(ab, economy) {
  const speedOn = ab.speedModHits > 0;
  const flurryOn = ab.flurry.speedHits > 0;
  if (speedOn && flurryOn) return economy.speedAndFlurryAtkMult;
  if (speedOn) return economy.speedAtkMult;
  if (flurryOn) return economy.flurryAtkMult;
  return 1;
}

function tryCastXpAbilities(ab, rt, staminaRef, maxStamina, rng, economy) {
  if (rt.enrage.enabled && !ab.enrage.active && ab.enrage.cooldown <= 0) {
    ab.enrage.active = true;
    ab.enrage.charges = rt.enrage.charges * instachargeCasts(rt, rng);
    ab.enrage.cooldown = rt.enrage.cooldownHits;
  }
  if (rt.flurry.enabled && ab.flurry.cooldown <= 0) {
    const beforeMult = attackSpeedMult(ab, economy);
    const casts = instachargeCasts(rt, rng);
    staminaRef.current = Math.min(
      maxStamina,
      staminaRef.current + rt.flurry.staminaOnCast * casts,
    );
    ab.flurry.cooldown = rt.flurry.cooldownHits;
    ab.flurry.speedHits += rt.flurry.charges * casts;
    markInstantAttackOnSpeedIncrease(ab, economy, beforeMult);
  }
  if (rt.quake.enabled && !ab.quake.active && ab.quake.cooldown <= 0) {
    ab.quake.active = true;
    ab.quake.charges = rt.quake.charges * instachargeCasts(rt, rng);
    ab.quake.cooldown = rt.quake.cooldownHits;
  }
}

function xpForBlock(block, economy) {
  if (block.xpAwarded) return 0;
  block.xpAwarded = true;
  let mult = economy.expGainMult;
  if (block.mods.exp) mult *= economy.expModGainMult;
  return block.baseExp * mult;
}

function onBlockBroken(block, economy, staminaRef, maxStamina) {
  let xp = xpForBlock(block, economy);
  if (block.mods.stamina) {
    staminaRef.current = Math.min(
      maxStamina,
      staminaRef.current + economy.staminaModGain,
    );
  }
  return xp;
}

/** First hit on a speed-mod block adds hit count; stacks while speed already active. */
function onHitBlock(block, ab, economy) {
  const speedBefore = ab.speedModHits || 0;
  if (!block.mods.speed || block.speedModApplied) {
    return { speedBefore, speedGained: 0 };
  }
  const beforeMult = attackSpeedMult(ab, economy);
  block.speedModApplied = true;
  const gained = economy.speedModGainHits;
  ab.speedModHits += gained;
  markInstantAttackOnSpeedIncrease(ab, economy, beforeMult);
  return { speedBefore, speedGained: gained };
}

function drainBrokenXp(run, economy, staminaRef, maxStamina) {
  let xp = 0;
  while (run.broken.length) {
    const b = run.broken.pop();
    if (b.remainingHp <= 0 && !b.xpAwarded) {
      xp += onBlockBroken(b, economy, staminaRef, maxStamina);
    }
  }
  return xp;
}

function performXpHit(run, combat, rt, ab, economy, staminaRef, maxStamina, rng) {
  const target = currentTarget(run);
  if (!target) return { hit: false, xp: 0, seconds: 0 };

  const attackMultForHit = attackSpeedMult(ab, economy);
  const instant = ab.instantAttackPending === true;
  ab.instantAttackPending = false;
  const { speedBefore } = onHitBlock(target, ab, economy);
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  damageBlock(
    run,
    target,
    rollHitDamage(rng, combat, target.armor, rt, enrageOn),
  );
  applyQuakeCleave(run, target, combat, rt, ab, rng);

  if (enrageOn) {
    ab.enrage.charges--;
    if (ab.enrage.charges <= 0) {
      ab.enrage.active = false;
    }
  }

  const xp = drainBrokenXp(run, economy, staminaRef, maxStamina);
  const seconds = instant ? 0 : 1 / attackMultForHit;
  if (speedBefore > 0 && ab.speedModHits > 0) ab.speedModHits--;
  advanceTrackedSecondTimer(ab, attackMultForHit);

  return { hit: true, xp, seconds };
}

/** Cached combat/economy/stages for many XP MC trials on one build. */
function createXpRunContext(build, lookup) {
  const cardCtx = buildCardContext(build, lookup);
  return {
    combat: computeCombat(build, lookup),
    rt: buildAbilityRuntime(build, lookup),
    economy: buildXpEconomy(build, lookup),
    cardCtx,
    stageCache: buildStageCache(lookup, cardCtx, cardBuffForBlock),
  };
}

/**
 * One stamina bar: returns XP, elapsed seconds, max stage.
 * Models exp/speed/stamina block mods, flurry attack speed, enrage/quake.
 */
function simulateXpRun(build, lookup, rng, ctx) {
  const runCtx = ctx ?? createXpRunContext(build, lookup);
  const { combat, rt, economy, stageCache } = runCtx;
  const ab = createXpAbilityState(rt, rng);
  const staminaRef = { current: combat.maxStamina };

  let stamina = staminaRef.current;
  let stage = 1;
  let maxStage = 1;
  let totalXp = 0;
  let elapsed = 0;
  const crosshairTimer = createCrosshairTimerState();
  let blockRun = createBlockRunState(makeXpBlocks(stage, rng, stageCache, economy));

  while (stamina > 0) {
    if (blockRun.alive === 0) {
      stage += 1;
      maxStage = Math.max(maxStage, stage);
      if (stage > 200) break;
      blockRun = createBlockRunState(makeXpBlocks(stage, rng, stageCache, economy));
      continue;
    }

    staminaRef.current = stamina;
    tryCastXpAbilities(ab, rt, staminaRef, combat.maxStamina, rng, economy);
    stamina = staminaRef.current;

    const result = performXpHit(
      blockRun,
      combat,
      rt,
      ab,
      economy,
      staminaRef,
      combat.maxStamina,
      rng,
    );
    if (!result.hit) break;
    totalXp += result.xp;
    const nextElapsed = elapsed + result.seconds;
    applyCrosshairTimerTicks(
      blockRun,
      combat,
      rt,
      ab,
      rng,
      crosshairTimer,
      elapsed,
      nextElapsed,
    );
    totalXp += drainBrokenXp(blockRun, economy, staminaRef, combat.maxStamina);
    elapsed = nextElapsed;
    stamina = staminaRef.current;
    stamina -= 1;
  }

  maxStage = resolveMaxStage(
    stage,
    maxStage,
    blockRun.blocks,
    stamina,
    blockRun.alive,
  );
  const xpPerHour = elapsed > 0 ? (totalXp / elapsed) * 3600 : 0;
  return { xp: totalXp, seconds: elapsed, maxStage, xpPerHour };
}

function percentileOf(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * sorted.length)),
  );
  return sorted[idx];
}

function binXpHist(samples, binWidth = 50) {
  const hist = new Map();
  for (const v of samples) {
    const bucket = Math.round(v / binWidth) * binWidth;
    hist.set(bucket, (hist.get(bucket) || 0) + 1);
  }
  return hist;
}

function runXpMonteCarlo(
  build,
  lookup,
  { trials = 800, seed = 1, scoreOnly = false } = {},
) {
  const rng = mulberry32(seed);
  const ctx = createXpRunContext(build, lookup);
  let sumXp = 0;
  let sumSeconds = 0;
  let sumStage = 0;
  let sumXpPerHour = 0;
  const xpHrSamples = scoreOnly ? null : [];

  for (let i = 0; i < trials; i++) {
    const r = simulateXpRun(build, lookup, rng, ctx);
    sumXp += r.xp;
    sumSeconds += r.seconds;
    sumXpPerHour += r.xpPerHour;
    sumStage += r.maxStage;
    if (xpHrSamples) xpHrSamples.push(r.xpPerHour);
  }

  const meanXp = sumXp / trials;
  const meanSeconds = sumSeconds / trials;
  const meanXpPerHour = sumXpPerHour / trials;
  const ratioOfMeansXpPerHour =
    sumSeconds > 0 ? (sumXp / sumSeconds) * 3600 : 0;
  const meanMaxStage = sumStage / trials;

  if (scoreOnly) {
    return {
      meanXp,
      meanSeconds,
      meanXpPerHour,
      ratioOfMeansXpPerHour,
      meanMaxStage,
      trials,
      mean: meanXpPerHour,
    };
  }

  xpHrSamples.sort((a, b) => a - b);
  const percentiles = {
    0.1: percentileOf(xpHrSamples, 0.1),
    0.5: percentileOf(xpHrSamples, 0.5),
    0.9: percentileOf(xpHrSamples, 0.9),
    0.95: percentileOf(xpHrSamples, 0.95),
  };
  return {
    meanXp,
    meanSeconds,
    meanXpPerHour,
    ratioOfMeansXpPerHour,
    meanMaxStage,
    hist: binXpHist(xpHrSamples, 50),
    xpHrSamples,
    percentiles,
    minXpPerHour: xpHrSamples[0] ?? 0,
    maxXpPerHour: xpHrSamples[xpHrSamples.length - 1] ?? 0,
    trials,
    mean: meanXpPerHour,
  };
}

function rollFragmentBlockMods(rng, economy) {
  const mods = {};
  if (rng() < economy.expModChance) mods.exp = true;
  if (rng() < economy.speedModChance) mods.speed = true;
  if (rng() < economy.staminaModChance) mods.stamina = true;
  if (rng() < economy.lootModChance) mods.loot = true;
  return mods;
}

function makeFragmentBlock(family, hp, armor, baseExp, baseFragments, mods, tierNum = null) {
  return {
    family,
    tier: tierNum,
    hp,
    armor,
    remainingHp: hp,
    baseExp,
    baseFragments,
    mods,
    xpAwarded: false,
    fragmentsAwarded: false,
    speedModApplied: false,
    initialHp: hp,
  };
}

function makeFragmentBlocks(stage, rng, stageCache, economy) {
  const entry = getStageCacheEntry(stageCache, stage);
  const blocks = [];
  if (!entry) return blocks;

  const pushFromTemplate = (t) => {
    blocks.push(
      makeFragmentBlock(
        t.family,
        t.hp,
        t.armor,
        t.exp,
        t.fragments ?? 0,
        rollFragmentBlockMods(rng, economy),
        t.tierNum,
      ),
    );
  };

  if (entry.bossBlocks) {
    for (const t of entry.bossBlocks) pushFromTemplate(t);
  } else {
    for (let i = 0; i < entry.gridSlots; i++) {
      const fam = rollFamilyFromCache(rng, entry);
      if (!fam) continue;
      pushFromTemplate({ family: fam, ...entry.familyStats[fam] });
    }
  }

  stampInitialHp(blocks);
  return blocks;
}

function fragForBlock(block, economy) {
  if (block.fragmentsAwarded) return 0;
  if (!block.baseFragments || block.baseFragments <= 0) return 0;
  block.fragmentsAwarded = true;
  let mult = economy.fragmentGainMult;
  if (block.mods.loot) mult *= economy.lootModGainMult;
  return block.baseFragments * mult;
}

function onFragmentBlockBroken(block, economy, staminaRef, maxStamina) {
  const frags = fragForBlock(block, economy);
  if (block.mods.stamina) {
    staminaRef.current = Math.min(
      maxStamina,
      staminaRef.current + economy.staminaModGain,
    );
  }
  return frags;
}

function drainBrokenFragments(
  run,
  economy,
  staminaRef,
  maxStamina,
  currencyForFamily,
  targetCurrency,
) {
  let fragments = 0;
  while (run.broken.length) {
    const b = run.broken.pop();
    if (b.remainingHp > 0 || b.fragmentsAwarded) continue;
    const cur = currencyForFamily[b.family];
    if (cur === targetCurrency) {
      fragments += onFragmentBlockBroken(b, economy, staminaRef, maxStamina);
    } else if (cur) {
      onFragmentBlockBroken(b, economy, staminaRef, maxStamina);
    }
  }
  return fragments;
}

function performFragmentHit(
  run,
  combat,
  rt,
  ab,
  economy,
  staminaRef,
  maxStamina,
  rng,
  currencyForFamily,
  targetCurrency,
) {
  const target = currentTarget(run);
  if (!target) return { hit: false, fragments: 0, seconds: 0 };

  const attackMultForHit = attackSpeedMult(ab, economy);
  const instant = ab.instantAttackPending === true;
  ab.instantAttackPending = false;
  const { speedBefore } = onHitBlock(target, ab, economy);
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  damageBlock(
    run,
    target,
    rollHitDamage(rng, combat, target.armor, rt, enrageOn),
  );
  applyQuakeCleave(run, target, combat, rt, ab, rng);

  if (enrageOn) {
    ab.enrage.charges--;
    if (ab.enrage.charges <= 0) {
      ab.enrage.active = false;
    }
  }

  const fragments = drainBrokenFragments(
    run,
    economy,
    staminaRef,
    maxStamina,
    currencyForFamily,
    targetCurrency,
  );
  const seconds = instant ? 0 : 1 / attackMultForHit;
  if (speedBefore > 0 && ab.speedModHits > 0) ab.speedModHits--;
  advanceTrackedSecondTimer(ab, attackMultForHit);

  return { hit: true, fragments, seconds };
}

function buildCurrencyForFamily(lookup) {
  const map = {};
  for (const [family, def] of Object.entries(lookup.blocks.families || {})) {
    if (def.fragment_currency) map[family] = def.fragment_currency;
  }
  return map;
}

/** Cached combat/economy/stages for many fragment MC trials on one build. */
function createFragmentRunContext(build, lookup) {
  const cardCtx = buildCardContext(build, lookup);
  return {
    combat: computeCombat(build, lookup),
    rt: buildAbilityRuntime(build, lookup),
    economy: buildFragmentEconomy(build, lookup),
    cardCtx,
    stageCache: buildStageCache(lookup, cardCtx, cardBuffForBlock),
    currencyForFamily: buildCurrencyForFamily(lookup),
  };
}

/**
 * One stamina bar: returns target-currency fragments, elapsed seconds, max stage.
 */
function simulateFragmentRun(build, lookup, rng, targetCurrency, ctx) {
  const runCtx = ctx ?? createFragmentRunContext(build, lookup);
  const { combat, rt, economy, stageCache, currencyForFamily } = runCtx;
  const ab = createXpAbilityState(rt, rng);
  const staminaRef = { current: combat.maxStamina };

  let stamina = staminaRef.current;
  let stage = 1;
  let maxStage = 1;
  let totalFragments = 0;
  let elapsed = 0;
  const crosshairTimer = createCrosshairTimerState();
  let blockRun = createBlockRunState(
    makeFragmentBlocks(stage, rng, stageCache, economy),
  );

  while (stamina > 0) {
    if (blockRun.alive === 0) {
      stage += 1;
      maxStage = Math.max(maxStage, stage);
      if (stage > 200) break;
      blockRun = createBlockRunState(
        makeFragmentBlocks(stage, rng, stageCache, economy),
      );
      continue;
    }

    staminaRef.current = stamina;
    tryCastXpAbilities(ab, rt, staminaRef, combat.maxStamina, rng, economy);
    stamina = staminaRef.current;

    const result = performFragmentHit(
      blockRun,
      combat,
      rt,
      ab,
      economy,
      staminaRef,
      combat.maxStamina,
      rng,
      currencyForFamily,
      targetCurrency,
    );
    if (!result.hit) break;
    totalFragments += result.fragments;
    const nextElapsed = elapsed + result.seconds;
    applyCrosshairTimerTicks(
      blockRun,
      combat,
      rt,
      ab,
      rng,
      crosshairTimer,
      elapsed,
      nextElapsed,
    );
    totalFragments += drainBrokenFragments(
      blockRun,
      economy,
      staminaRef,
      combat.maxStamina,
      currencyForFamily,
      targetCurrency,
    );
    elapsed = nextElapsed;
    stamina = staminaRef.current;
    stamina -= 1;
  }

  maxStage = resolveMaxStage(
    stage,
    maxStage,
    blockRun.blocks,
    stamina,
    blockRun.alive,
  );
  const fragPerHour = elapsed > 0 ? (totalFragments / elapsed) * 3600 : 0;
  return { fragments: totalFragments, seconds: elapsed, maxStage, fragPerHour };
}

/** Pick a bin width that yields ~6–10 buckets for the observed frag/hr spread. */
function pickFragHistBinWidth(samples) {
  if (!samples?.length) return 0.5;
  const lo = samples[0];
  const hi = samples[samples.length - 1];
  const range = Math.max(hi - lo, 0.01);
  const raw = range / 8;
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10];
  for (const step of steps) {
    if (raw <= step * 1.25) return step;
  }
  return 10;
}

function binFragHist(samples, binWidth) {
  const width = binWidth ?? pickFragHistBinWidth(samples);
  const hist = new Map();
  for (const v of samples) {
    const bucket = Math.round(v / width) * width;
    const key = Math.round(bucket * 1000) / 1000;
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  return { hist, binWidth: width };
}

function runFragmentMonteCarlo(
  build,
  lookup,
  { trials = 800, seed = 1, targetCurrency = "common", scoreOnly = false } = {},
) {
  const rng = mulberry32(seed);
  const ctx = createFragmentRunContext(build, lookup);
  let sumFragments = 0;
  let sumSeconds = 0;
  let sumStage = 0;
  let sumFragPerHour = 0;
  const fragHrSamples = scoreOnly ? null : [];

  for (let i = 0; i < trials; i++) {
    const r = simulateFragmentRun(build, lookup, rng, targetCurrency, ctx);
    sumFragments += r.fragments;
    sumSeconds += r.seconds;
    sumFragPerHour += r.fragPerHour;
    sumStage += r.maxStage;
    if (fragHrSamples) fragHrSamples.push(r.fragPerHour);
  }

  const meanFragments = sumFragments / trials;
  const meanSeconds = sumSeconds / trials;
  const meanFragPerHour = sumFragPerHour / trials;
  const ratioOfMeansFragPerHour =
    sumSeconds > 0 ? (sumFragments / sumSeconds) * 3600 : 0;
  const meanMaxStage = sumStage / trials;

  if (scoreOnly) {
    return {
      meanFragments,
      meanSeconds,
      meanFragPerHour,
      ratioOfMeansFragPerHour,
      meanMaxStage,
      targetCurrency,
      trials,
      mean: meanFragPerHour,
    };
  }

  fragHrSamples.sort((a, b) => a - b);
  const percentiles = {
    0.1: percentileOf(fragHrSamples, 0.1),
    0.5: percentileOf(fragHrSamples, 0.5),
    0.9: percentileOf(fragHrSamples, 0.9),
    0.95: percentileOf(fragHrSamples, 0.95),
  };
  const { hist, binWidth: histBinWidth } = binFragHist(fragHrSamples);
  return {
    meanFragments,
    meanSeconds,
    meanFragPerHour,
    ratioOfMeansFragPerHour,
    meanMaxStage,
    targetCurrency,
    hist,
    histBinWidth,
    fragHrSamples,
    percentiles,
    minFragPerHour: fragHrSamples[0] ?? 0,
    maxFragPerHour: fragHrSamples[fragHrSamples.length - 1] ?? 0,
    trials,
    mean: meanFragPerHour,
  };
}

return { mulberry32, makeBlock, stampInitialHp, stageClearFraction, makeBlocks, createBlockRunState, currentTarget, damageBlock, createAbilityState, tickCooldowns, tryCastAbilities, attacksPerStamina, clampChance, instachargeCasts, createCrosshairTimerState, attackTimeSlice, initTrackedSecondTimer, decrementTimedAbilityCooldowns, advanceTrackedSecondTimer, markInstantAttackOnSpeedIncrease, rollCrosshairTapMultiplier, rollAutoCrosshairMultiplier, applyAutoCrosshair, applyAutoCrosshairToCurrent, applyAutoCrosshairsToAlive, applyCrosshairTimerTicks, applyQuakeCleave, performHit, resolveMaxStage, createPushRunContext, simulateRun, runMonteCarlo, createManualPushAbilityState, expectedFilledSlots, buildExpectedFilledSlotCache, castManualEnrage, castManualFlurry, castManualQuake, knownRemainingStaminaGain, estimatedHitsToClearCurrentStage, cannotClearCurrentStageWithQuakeReserve, shouldManualQuake, tryCastManualPushAbilities, rollManualCrosshairMultiplier, applyManualCrosshair, drainBrokenManual, applyManualCrosshairToCurrent, applyManualCrosshairsToAlive, applyManualCrosshairTimerTicks, performManualPushHit, createManualPushRunContext, simulateManualPushRun, runManualPushMonteCarlo, rollBlockMods, makeXpBlock, makeXpBlocks, createXpAbilityState, attackSpeedMult, tryCastXpAbilities, xpForBlock, onBlockBroken, onHitBlock, drainBrokenXp, performXpHit, createXpRunContext, simulateXpRun, percentileOf, binXpHist, runXpMonteCarlo, rollFragmentBlockMods, makeFragmentBlock, makeFragmentBlocks, fragForBlock, onFragmentBlockBroken, drainBrokenFragments, performFragmentHit, buildCurrencyForFamily, createFragmentRunContext, simulateFragmentRun, pickFragHistBinWidth, binFragHist, runFragmentMonteCarlo };
})();
modules["sim-matrix"] = (function() {
/**
 * Matrix-tape push simulator (fast approximation).
 *
 * Pipeline:
 *   1) Pre-roll on-hit tapes (categorical crit mults; flurry cast schedule)
 *   2) Per-stage block matrices (≤24 slots: HP, armor, initial HP)
 *   3) Sequential merge — primary target only; NO enrage / quake
 *
 * Same output shape as runMonteCarlo for drop-in comparison.
 */

const { computeCombat } = modules["build"];
const { buildCardContext, cardBuffForBlock } = modules["cards"];
const {
  baseDamageAfterArmor,
  buildAbilityRuntime,
  randomAbilityCooldown,
} = modules["combat-abilities"];
const { mulberry32 } = modules["sim"];
const {
  createSharedStageLayout,
  getStageCacheEntry,
  rollFamilyFromCache,
} = modules["stage-cache"];
const GRID_SLOTS = 24;
const MAX_STAGE = 200;

/** @returns {{ hp: Float64Array, armor: Float64Array, initialHp: Float64Array, count: number }} */
function makeStageMatrix(stage, rng, stageCache) {
  const entry = getStageCacheEntry(stageCache, stage);
  const hp = new Float64Array(GRID_SLOTS);
  const armor = new Float64Array(GRID_SLOTS);
  const initialHp = new Float64Array(GRID_SLOTS);
  let count = 0;

  const pushBlock = (stats) => {
    if (count >= GRID_SLOTS) return;
    hp[count] = stats.hp;
    armor[count] = stats.armor;
    initialHp[count] = stats.hp;
    count++;
  };

  if (!entry) return { hp, armor, initialHp, count };

  if (entry.bossBlocks) {
    for (const stats of entry.bossBlocks) pushBlock(stats);
    return { hp, armor, initialHp, count };
  }

  for (let i = 0; i < entry.gridSlots; i++) {
    const fam = rollFamilyFromCache(rng, entry);
    if (!fam) continue;
    pushBlock(entry.familyStats[fam]);
  }
  return { hp, armor, initialHp, count };
}

/** Categorical crit mult (no enrage). Mirrors rollCritMultiplier chain. */
function rollCritMult(rng, combat) {
  const critChance = Math.min(1, Math.max(0, combat.critChance ?? 0));
  if (rng() >= critChance) return 1;

  let mult = combat.critDamageMultiplier ?? 1.5;
  const superChance = Math.min(1, Math.max(0, combat.superCritChance ?? 0));
  if (superChance > 0 && rng() < superChance) {
    const ultraChance = Math.min(1, Math.max(0, combat.ultraCritChance ?? 0));
    if (ultraChance > 0 && rng() < ultraChance) {
      mult *= combat.ultraCritDamageMult ?? 3;
    } else {
      mult *= combat.superCritDamageMult ?? 2;
    }
  }
  return mult;
}

function primaryDamage(combat, blockArmor, critMult) {
  const base = baseDamageAfterArmor(combat, blockArmor);
  return Math.max(1, Math.floor(base * critMult));
}

function stageClearFraction(hp, initialHp, count) {
  let total = 0;
  let cleared = 0;
  for (let i = 0; i < count; i++) {
    total += initialHp[i];
    cleared += Math.max(0, initialHp[i] - Math.max(0, hp[i]));
  }
  return total > 0 ? Math.min(1, cleared / total) : 1;
}

function anyAlive(hp, count) {
  for (let i = 0; i < count; i++) {
    if (hp[i] > 0) return true;
  }
  return false;
}

function ensureCritTape(tape, rng, combat, needed) {
  while (tape.length < needed) {
    tape.push(rollCritMult(rng, combat));
  }
}

/**
 * Z-bound stage clear: counterfactual HP matrix + sequential front-target consume.
 * Applies pre-rolled crit tape; returns tape index after stage.
 */
function clearStageFromTapes(hp, armor, initialHp, count, combat, critTape, tapeIdx, stamina) {
  let gi = tapeIdx;
  let st = stamina;
  let target = 0;

  while (st > 0 && target < count) {
    while (target < count && hp[target] <= 0) target++;
    if (target >= count) break;

    const dmg = primaryDamage(combat, armor[target], critTape[gi++]);
    hp[target] -= dmg;
    st--;

    if (hp[target] <= 0) {
      hp[target] = 0;
      target++;
    } else {
      break;
    }
  }

  return {
    tapeIdx: gi,
    staminaLeft: st,
    allCleared: !anyAlive(hp, count),
    clearFraction: stageClearFraction(hp, initialHp, count),
  };
}

function resolveMaxStage(stage, maxStage, hp, initialHp, count, staminaLeft) {
  const alive = anyAlive(hp, count);
  if (staminaLeft > 0 && !alive) return maxStage;
  if (staminaLeft <= 0 && alive) {
    const partial = stage - 1 + stageClearFraction(hp, initialHp, count);
    return Math.max(maxStage, partial);
  }
  return maxStage;
}

/** Cached combat / flurry runtime / stage layouts for many batch trials on one build. */
function createMatrixPushContext(build, lookup, sharedLayout = null) {
  const layout =
    sharedLayout ?? createSharedStageLayout(build, lookup, cardBuffForBlock, MAX_STAGE);
  return {
    combat: computeCombat(build, lookup),
    rt: buildAbilityRuntime(build, lookup),
    cardCtx: layout.cardCtx,
    stageCache: layout.stageCache,
  };
}

/** One push run via matrix tapes. Returns max stage reached. */
function simulateMatrixPushRun(build, lookup, rng, ctx) {
  const runCtx = ctx ?? createMatrixPushContext(build, lookup);
  const { combat, rt, stageCache } = runCtx;
  const maxStamina = combat.maxStamina;

  let flurryCd = rt.flurry.enabled
    ? randomAbilityCooldown(rng, rt.flurry.cooldownHits)
    : Infinity;

  const critTape = [];
  let tapeIdx = 0;

  let stamina = maxStamina;
  let stage = 1;
  let maxStage = 1;
  let matrix = makeStageMatrix(stage, rng, stageCache);
  let { hp, armor, initialHp, count } = matrix;

  while (stamina > 0) {
    if (count === 0 || !anyAlive(hp, count)) {
      if (count === 0) break;
      stage += 1;
      maxStage = Math.max(maxStage, stage);
      if (stage > MAX_STAGE) break;
      matrix = makeStageMatrix(stage, rng, stageCache);
      hp = matrix.hp;
      armor = matrix.armor;
      initialHp = matrix.initialHp;
      count = matrix.count;
      if (count === 0) break;
      continue;
    }

    if (rt.flurry.enabled) {
      if (flurryCd > 0) flurryCd--;
      if (flurryCd <= 0) {
        stamina = Math.min(maxStamina, stamina + rt.flurry.staminaOnCast);
        flurryCd = rt.flurry.cooldownHits;
      }
    }

    ensureCritTape(critTape, rng, combat, tapeIdx + stamina + 8);

    const before = stamina;
    const result = clearStageFromTapes(
      hp,
      armor,
      initialHp,
      count,
      combat,
      critTape,
      tapeIdx,
      stamina,
    );
    tapeIdx = result.tapeIdx;
    stamina = result.staminaLeft;

    if (stamina === before) break;
  }

  return resolveMaxStage(stage, maxStage, hp, initialHp, count, stamina);
}

function runMatrixMonteCarlo(
  build,
  lookup,
  { trials = 800, seed = 1, scoreOnly = false } = {},
  sharedLayout = null,
) {
  const rng = mulberry32(seed);
  const ctx = createMatrixPushContext(build, lookup, sharedLayout);
  const hist = scoreOnly ? null : new Map();
  let sum = 0;
  for (let i = 0; i < trials; i++) {
    const s = simulateMatrixPushRun(build, lookup, rng, ctx);
    sum += s;
    if (hist) hist.set(s, (hist.get(s) || 0) + 1);
  }
  const mean = sum / trials;
  if (scoreOnly) {
    return { mean, trials, engine: "matrix" };
  }
  const sorted = [...hist.keys()].sort((a, b) => a - b);
  const percentile = (p) => {
    const target = p * trials;
    let acc = 0;
    for (const s of sorted) {
      acc += hist.get(s);
      if (acc >= target) return s;
    }
    return sorted.length ? sorted[sorted.length - 1] : 0;
  };
  const percentiles = { 0.5: percentile(0.5), 0.9: percentile(0.9), 0.95: percentile(0.95) };
  return { mean, hist, percentiles, trials, engine: "matrix" };
}

return { makeStageMatrix, rollCritMult, primaryDamage, stageClearFraction, anyAlive, ensureCritTape, clearStageFromTapes, resolveMaxStage, createMatrixPushContext, simulateMatrixPushRun, runMatrixMonteCarlo, GRID_SLOTS, MAX_STAGE };
})();

const { runFragmentMonteCarlo, runManualPushMonteCarlo, runMonteCarlo, runXpMonteCarlo } = modules["sim"];
const { runMatrixMonteCarlo } = modules["sim-matrix"];
const { createSharedStageLayout } = modules["stage-cache"];
const { cardBuffForBlock } = modules["cards"];

function indexLookup(lookup) {
  const upgradeById = {};
  for (const [tier, list] of Object.entries(lookup.upgrades.by_fragment_tier)) {
    for (const u of list) {
      upgradeById[u.id] = Object.assign({}, u, { fragment_tier: tier });
    }
  }
  for (const u of lookup.gem_upgrades.upgrades) {
    upgradeById[u.id] = Object.assign({}, u, { fragment_tier: "gem" });
  }
  lookup._upgradeById = upgradeById;
  return lookup;
}

var lookupIndexed = null;

function scoreBuild(mode, build, mcOpts, sharedLayout) {
  if (mode === "matrix") {
    return runMatrixMonteCarlo(build, lookupIndexed, mcOpts, sharedLayout).mean;
  }
  if (mode === "xp") {
    return runXpMonteCarlo(build, lookupIndexed, mcOpts).meanXpPerHour;
  }
  if (mode === "manual_push") {
    return runManualPushMonteCarlo(build, lookupIndexed, mcOpts, sharedLayout).mean;
  }
  if (mode === "fragment") {
    return runFragmentMonteCarlo(build, lookupIndexed, mcOpts).meanFragPerHour;
  }
  return runMonteCarlo(build, lookupIndexed, mcOpts, sharedLayout).mean;
}

self.onmessage = function(e) {
  var msg = e.data || {};
  if (msg.type === "init") {
    try {
      lookupIndexed = indexLookup(msg.lookup);
      self.postMessage({ type: "ready", workerId: msg.workerId });
    } catch (err) {
      self.postMessage({ type: "error", workerId: msg.workerId, message: String(err && err.message || err) });
    }
    return;
  }
  if (msg.type === "eval") {
    try {
      var score = scoreBuild(msg.mode, msg.build, msg.mcOpts);
      self.postMessage({ type: "result", id: msg.id, score: score });
    } catch (err) {
      self.postMessage({ type: "result", id: msg.id, error: String(err && err.message || err) });
    }
    return;
  }
  if (msg.type === "evalBatch") {
    try {
      var results = [];
      var items = msg.items || [];
      var sharedLayout = items.length > 1
        ? createSharedStageLayout(msg.baseBuild, lookupIndexed, cardBuffForBlock, 200)
        : null;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var trialBuild = Object.assign({}, msg.baseBuild, { stat_levels: item.sl });
        results.push({ key: item.key, score: scoreBuild(msg.mode, trialBuild, msg.mcOpts, sharedLayout) });
      }
      self.postMessage({ type: "batchResult", id: msg.id, results: results });
    } catch (err) {
      self.postMessage({ type: "batchResult", id: msg.id, error: String(err && err.message || err) });
    }
  }
};
})();
