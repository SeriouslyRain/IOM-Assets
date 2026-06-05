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
function computeFragmentGainMult(up, sl) {
  let fragMult =
    1 +
    (up.fragment_gain_percent || 0) +
    (sl.perception || 0) * 0.04;
  if (up.fragment_gain_multiplier) {
    fragMult *= up.fragment_gain_multiplier;
  }
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

  const strBuffLv = build.upgrade_levels?.common?.strength_stat_buff ?? 0;
  const flatPerStr = 1 + (up.strength_flat_damage_bonus || 0) * strBuffLv;
  const pctPerStr = 0.01 + (up.strength_damage_percent_bonus || 0) * strBuffLv;

  let flat = baseDamageFromLookup(lookup);
  flat += up.flat_damage || 0;
  flat += str * flatPerStr;
  flat += (sl.divinity || 0) * 2;

  let damageMult = 1;
  damageMult += str * pctPerStr;
  damageMult += up.damage_percent || 0;
  damageMult += (sl.corruption || 0) * 0.06;

  let maxStamina = BASE_MAX_STAMINA;
  maxStamina += agi * 5;
  maxStamina += up.max_stamina || 0;
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

  const totalDamage = Math.max(1, Math.floor(flat * damageMult));
  const rawPerHit = totalDamage;

  const superCritChance =
    (up.super_crit_chance || 0) + (sl.divinity || 0) * 0.02;
  const ultraCritChance = up.ultra_crit_chance || 0;
  const { superCritDamageMult, ultraCritDamageMult } =
    superUltraCritDamageMults(up, lookup);

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
  const fragMult = computeFragmentGainMult(up, sl);

  const expModChance =
    (sl.intellect || 0) * 0.003 +
    (up.experience_mod_proc_chance || 0) +
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
    damage: Math.round(combat.rawPerHit ?? combat.flat * combat.damageMult),
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
    abilityInstacharge: up.ability_instacharge_chance || 0,
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


return { baseDamageFromLookup, baseCritDamageMultFromLookup, baseUltraCritDamageMultFromLookup, sumUpgradeEffects, statCap, totalStatBudget, sumAllocated, clampStatLevels, upgradeEffectLines, critDamageBonusFraction, critDamageMultiplierFromBuild, superUltraCritDamageMults, computeExpGainMult, computeFragmentGainMult, computeCritDamageBreakdown, computeCombat, damageVsArmor, hitsToBreak, computeBuildReport, buildXpEconomy, buildFragmentEconomy, BASE_DAMAGE, BASE_MAX_STAMINA, BASE_CRIT_DAMAGE_MULTIPLIER, BASE_ULTRA_CRIT_DAMAGE_MULTIPLIER, STAT_IDS };
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

const { sumUpgradeEffects } = modules["build"];
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

  return {
    enrage: {
      enabled: enabled.enrage,
      charges: enrageDef.charges ?? 5,
      cooldownHits: cooldownHits(
        (enrageDef.cooldown_seconds ?? 60) + (up.enrage_cooldown_attacks || 0),
      ),
      damagePercent:
        (enrageAtk.damage_percent ?? 0) + (up.enrage_damage_percent || 0),
      critDamagePercent:
        (enrageAtk.crit_damage_percent ?? 0) + (up.enrage_crit_damage_percent || 0),
    },
    flurry: {
      enabled: enabled.flurry,
      charges: flurryDef.charges ?? 5,
      cooldownHits: cooldownHits(
        (flurryDef.cooldown_seconds ?? 120) + (up.flurry_cooldown_attacks || 0),
      ),
      staminaOnCast:
        (flurryCast.stamina_added ?? 5) + (up.flurry_stamina_on_cast || 0),
      speedMult:
        lookup.combat_timing?.attack_speed_multipliers?.flurry_active ?? 2,
    },
    quake: {
      enabled: enabled.quake,
      charges:
        (quakeDef.charges ?? 5) + (up.quake_attacks_per_activation || 0),
      cooldownHits: cooldownHits(
        (quakeDef.cooldown_seconds ?? 180) + (up.quake_cooldown_attacks || 0),
      ),
      cleavePercent: quakeAtk.cleave_damage_percent_of_hit ?? 0.2,
    },
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
function rollHitDamage(rng, combat, armor, rt, enrageActive) {
  let base = baseDamageAfterArmor(combat, armor);
  if (enrageActive && rt?.enrage?.enabled) {
    base = Math.max(1, Math.floor(base * (1 + (rt.enrage.damagePercent ?? 0))));
  }
  const critMult = rollCritMultiplier(rng, combat, enrageActive, rt);
  return Math.max(1, Math.floor(base * critMult));
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

return { normalizeAbilities, buildAbilityRuntime, effectiveArmor, integerRawDamage, baseDamageAfterArmor, rollCritMultiplier, rollHitDamage, rollQuakeCleaveDamage, randomAbilityCooldown, createRolledAbilityState, damageForHit, DEFAULT_ABILITIES };
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
  createRolledAbilityState,
  rollHitDamage,
  rollQuakeCleaveDamage,
} = modules["combat-abilities"];
const FAMILIES = ["dirt", "common", "rare", "epic", "legendary", "mythic"];

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
  const key = String(stage);
  return lookup.boss_stages.stages[key] || null;
}

function rollSlot(rng, band) {
  const perc = band.percent;
  const sum = Object.values(perc).reduce((a, b) => a + b, 0);
  const emptyChance = (100 - sum) / 100;
  if (rng() < emptyChance) return null;
  const r = rng() * sum;
  let acc = 0;
  for (const fam of FAMILIES) {
    if (perc[fam] == null) continue;
    acc += perc[fam];
    if (r <= acc) return fam;
  }
  return FAMILIES.find((f) => perc[f] != null) ?? null;
}

function scaledBlockStats(family, tier, hpM, arM, cardCtx) {
  const buff = cardBuffForBlock(family, tier.tier, cardCtx);
  const baseFrag = tier.fragments ?? 0;
  return {
    hp: tier.hp * hpM * buff.hpMult,
    armor: tier.armor * arM,
    exp: tier.exp * buff.expLootMult,
    fragments: baseFrag > 0 ? baseFrag * buff.expLootMult : 0,
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

function makeBlocks(stage, rng, lookup, cardCtx) {
  const boss = bossLayout(stage, lookup);
  const hpM = stageScale(stage, lookup, "hp");
  const arM = stageScale(stage, lookup, "armor");
  const blocks = [];

  if (boss) {
    for (const [fam, count] of Object.entries(boss)) {
      const tier = tierAtStage(fam, stage, lookup);
      const stats = scaledBlockStats(fam, tier, hpM, arM, cardCtx);
      for (let i = 0; i < count; i++) {
        blocks.push(makeBlock(fam, stats.hp, stats.armor, tier.tier));
      }
    }
    stampInitialHp(blocks);
    return blocks;
  }

  const band = getSpawnBand(stage, lookup);
  for (let i = 0; i < lookup.boss_stages.grid_slots; i++) {
    const fam = rollSlot(rng, band);
    if (!fam) continue;
    const tier = tierAtStage(fam, stage, lookup);
    const stats = scaledBlockStats(fam, tier, hpM, arM, cardCtx);
    blocks.push(makeBlock(fam, stats.hp, stats.armor, tier.tier));
  }
  stampInitialHp(blocks);
  return blocks;
}

/** First living block in spawn order. */
function pickTarget(blocks) {
  for (const b of blocks) {
    if (b.remainingHp > 0) return b;
  }
  return null;
}

function applyDamageToBlock(block, dmg) {
  block.remainingHp -= dmg;
  if (block.remainingHp <= 0) block.remainingHp = 0;
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

function tryCastAbilities(ab, rt, staminaRef, maxStamina) {
  if (rt.enrage.enabled && !ab.enrage.active && ab.enrage.cooldown <= 0) {
    ab.enrage.active = true;
    ab.enrage.charges = rt.enrage.charges;
  }
  if (rt.flurry.enabled && ab.flurry.cooldown <= 0) {
    staminaRef.current = Math.min(maxStamina, staminaRef.current + rt.flurry.staminaOnCast);
    ab.flurry.cooldown = rt.flurry.cooldownHits;
  }
  if (rt.quake.enabled && !ab.quake.active && ab.quake.cooldown <= 0) {
    ab.quake.active = true;
    ab.quake.charges = rt.quake.charges;
  }
}

function attacksPerStamina() {
  return 1;
}

function applyQuakeCleave(blocks, target, combat, rt, ab, rng) {
  if (!ab.quake.active || !rt.quake.enabled || ab.quake.charges <= 0) return;
  for (const b of blocks) {
    if (b === target || b.remainingHp <= 0) continue;
    applyDamageToBlock(b, rollQuakeCleaveDamage(rng, combat, rt));
  }
  ab.quake.charges--;
  if (ab.quake.charges <= 0) {
    ab.quake.active = false;
    ab.quake.cooldown = rt.quake.cooldownHits;
  }
}

function performHit(blocks, combat, rt, ab, rng) {
  const target = pickTarget(blocks);
  if (!target) return false;

  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  applyDamageToBlock(
    target,
    rollHitDamage(rng, combat, target.armor, rt, enrageOn),
  );
  applyQuakeCleave(blocks, target, combat, rt, ab, rng);

  if (enrageOn) {
    ab.enrage.charges--;
    if (ab.enrage.charges <= 0) {
      ab.enrage.active = false;
      ab.enrage.cooldown = rt.enrage.cooldownHits;
    }
  }

  return true;
}

function resolveMaxStage(stage, maxStage, blocks, staminaLeft) {
  const alive = blocks.some((b) => b.remainingHp > 0);
  if (staminaLeft > 0 && !alive) return maxStage;
  if (staminaLeft <= 0 && alive) {
    const partial = (stage - 1) + stageClearFraction(blocks);
    return Math.max(maxStage, partial);
  }
  return maxStage;
}

/** Cached combat/abilities/cards for many MC trials on one build. */
function createPushRunContext(build, lookup) {
  return {
    combat: computeCombat(build, lookup),
    rt: buildAbilityRuntime(build, lookup),
    cardCtx: buildCardContext(build, lookup),
  };
}

/** One run; returns max stage reached. */
function simulateRun(build, lookup, rng, ctx) {
  const runCtx = ctx ?? createPushRunContext(build, lookup);
  const { combat, rt, cardCtx } = runCtx;
  const ab = createAbilityState(rt, rng);
  const staminaRef = { current: combat.maxStamina };

  let stamina = staminaRef.current;
  let stage = 1;
  let maxStage = 1;
  let blocks = makeBlocks(stage, rng, lookup, cardCtx);

  while (stamina > 0) {
    if (!blocks.some((b) => b.remainingHp > 0)) {
      stage += 1;
      maxStage = Math.max(maxStage, stage);
      if (stage > 200) break;
      blocks = makeBlocks(stage, rng, lookup, cardCtx);
      continue;
    }

    tickCooldowns(ab);
    staminaRef.current = stamina;
    tryCastAbilities(ab, rt, staminaRef, combat.maxStamina);
    stamina = staminaRef.current;

    const nAtk = attacksPerStamina();
    let hitDone = false;
    for (let i = 0; i < nAtk && stamina > 0; i++) {
      if (performHit(blocks, combat, rt, ab, rng)) hitDone = true;
      else break;
    }

    if (!hitDone) break;
    stamina -= 1;
  }

  return resolveMaxStage(stage, maxStage, blocks, stamina);
}

function runMonteCarlo(
  build,
  lookup,
  { trials = 800, seed = 1, scoreOnly = false } = {},
) {
  const rng = mulberry32(seed);
  const ctx = createPushRunContext(build, lookup);
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

function makeXpBlocks(stage, rng, lookup, economy, cardCtx) {
  const boss = bossLayout(stage, lookup);
  const hpM = stageScale(stage, lookup, "hp");
  const arM = stageScale(stage, lookup, "armor");
  const blocks = [];

  if (boss) {
    for (const [fam, count] of Object.entries(boss)) {
      const tier = tierAtStage(fam, stage, lookup);
      const stats = scaledBlockStats(fam, tier, hpM, arM, cardCtx);
      for (let i = 0; i < count; i++) {
        blocks.push(
          makeXpBlock(
            fam,
            stats.hp,
            stats.armor,
            stats.exp,
            rollBlockMods(rng, economy),
            tier.tier,
          ),
        );
      }
    }
    stampInitialHp(blocks);
    return blocks;
  }

  const band = getSpawnBand(stage, lookup);
  for (let i = 0; i < lookup.boss_stages.grid_slots; i++) {
    const fam = rollSlot(rng, band);
    if (!fam) continue;
    const tier = tierAtStage(fam, stage, lookup);
    const stats = scaledBlockStats(fam, tier, hpM, arM, cardCtx);
    blocks.push(
      makeXpBlock(
        fam,
        stats.hp,
        stats.armor,
        stats.exp,
        rollBlockMods(rng, economy),
        tier.tier,
      ),
    );
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

function tickXpCooldowns(ab) {
  if (ab.enrage.cooldown > 0) ab.enrage.cooldown--;
  if (ab.flurry.cooldown > 0) ab.flurry.cooldown--;
  if (ab.quake.cooldown > 0) ab.quake.cooldown--;
}

function tryCastXpAbilities(ab, rt, staminaRef, maxStamina) {
  if (rt.enrage.enabled && !ab.enrage.active && ab.enrage.cooldown <= 0) {
    ab.enrage.active = true;
    ab.enrage.charges = rt.enrage.charges;
  }
  if (rt.flurry.enabled && ab.flurry.cooldown <= 0) {
    staminaRef.current = Math.min(maxStamina, staminaRef.current + rt.flurry.staminaOnCast);
    ab.flurry.cooldown = rt.flurry.cooldownHits;
    ab.flurry.speedHits = rt.flurry.charges;
  }
  if (rt.quake.enabled && !ab.quake.active && ab.quake.cooldown <= 0) {
    ab.quake.active = true;
    ab.quake.charges = rt.quake.charges;
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
  if (!block.mods.speed || block.speedModApplied) return;
  block.speedModApplied = true;
  ab.speedModHits += economy.speedModGainHits;
}

function collectNewlyBroken(blocks) {
  return blocks.filter((b) => b.remainingHp <= 0 && !b.xpAwarded);
}

function performXpHit(blocks, combat, rt, ab, economy, staminaRef, maxStamina, rng) {
  const target = pickTarget(blocks);
  if (!target) return { hit: false, xp: 0, seconds: 0 };

  onHitBlock(target, ab, economy);
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  applyDamageToBlock(
    target,
    rollHitDamage(rng, combat, target.armor, rt, enrageOn),
  );
  applyQuakeCleave(blocks, target, combat, rt, ab, rng);

  if (enrageOn) {
    ab.enrage.charges--;
    if (ab.enrage.charges <= 0) {
      ab.enrage.active = false;
      ab.enrage.cooldown = rt.enrage.cooldownHits;
    }
  }

  let xp = 0;
  for (const b of blocks) {
    if (b.remainingHp <= 0 && !b.xpAwarded) {
      xp += onBlockBroken(b, economy, staminaRef, maxStamina);
    }
  }

  const seconds = 1 / attackSpeedMult(ab, economy);
  if (ab.speedModHits > 0) ab.speedModHits--;
  if (ab.flurry.speedHits > 0) ab.flurry.speedHits--;

  return { hit: true, xp, seconds };
}

/** Cached combat/economy for many XP MC trials on one build. */
function createXpRunContext(build, lookup) {
  return {
    combat: computeCombat(build, lookup),
    rt: buildAbilityRuntime(build, lookup),
    economy: buildXpEconomy(build, lookup),
    cardCtx: buildCardContext(build, lookup),
  };
}

/**
 * One stamina bar: returns XP, elapsed seconds, max stage.
 * Models exp/speed/stamina block mods, flurry attack speed, enrage/quake.
 */
function simulateXpRun(build, lookup, rng, ctx) {
  const runCtx = ctx ?? createXpRunContext(build, lookup);
  const { combat, rt, economy, cardCtx } = runCtx;
  const ab = createXpAbilityState(rt, rng);
  const staminaRef = { current: combat.maxStamina };

  let stamina = staminaRef.current;
  let stage = 1;
  let maxStage = 1;
  let totalXp = 0;
  let elapsed = 0;
  let blocks = makeXpBlocks(stage, rng, lookup, economy, cardCtx);

  while (stamina > 0) {
    if (!blocks.some((b) => b.remainingHp > 0)) {
      stage += 1;
      maxStage = Math.max(maxStage, stage);
      if (stage > 200) break;
      blocks = makeXpBlocks(stage, rng, lookup, economy, cardCtx);
      continue;
    }

    tickXpCooldowns(ab);
    staminaRef.current = stamina;
    tryCastXpAbilities(ab, rt, staminaRef, combat.maxStamina);
    stamina = staminaRef.current;

    const result = performXpHit(
      blocks,
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
    elapsed += result.seconds;
    stamina = staminaRef.current;
    stamina -= 1;
  }

  maxStage = resolveMaxStage(stage, maxStage, blocks, stamina);
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

function makeFragmentBlocks(stage, rng, lookup, economy, cardCtx) {
  const boss = bossLayout(stage, lookup);
  const hpM = stageScale(stage, lookup, "hp");
  const arM = stageScale(stage, lookup, "armor");
  const blocks = [];

  const pushBlock = (fam, stats, tierNum) => {
    blocks.push(
      makeFragmentBlock(
        fam,
        stats.hp,
        stats.armor,
        stats.exp,
        stats.fragments ?? 0,
        rollFragmentBlockMods(rng, economy),
        tierNum,
      ),
    );
  };

  if (boss) {
    for (const [fam, count] of Object.entries(boss)) {
      const tier = tierAtStage(fam, stage, lookup);
      const stats = scaledBlockStats(fam, tier, hpM, arM, cardCtx);
      for (let i = 0; i < count; i++) pushBlock(fam, stats, tier.tier);
    }
    stampInitialHp(blocks);
    return blocks;
  }

  const band = getSpawnBand(stage, lookup);
  for (let i = 0; i < lookup.boss_stages.grid_slots; i++) {
    const fam = rollSlot(rng, band);
    if (!fam) continue;
    const tier = tierAtStage(fam, stage, lookup);
    const stats = scaledBlockStats(fam, tier, hpM, arM, cardCtx);
    pushBlock(fam, stats, tier.tier);
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

function performFragmentHit(
  blocks,
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
  const target = pickTarget(blocks);
  if (!target) return { hit: false, fragments: 0, seconds: 0 };

  onHitBlock(target, ab, economy);
  const enrageOn = ab.enrage.active && rt.enrage.enabled;
  applyDamageToBlock(
    target,
    rollHitDamage(rng, combat, target.armor, rt, enrageOn),
  );
  applyQuakeCleave(blocks, target, combat, rt, ab, rng);

  if (enrageOn) {
    ab.enrage.charges--;
    if (ab.enrage.charges <= 0) {
      ab.enrage.active = false;
      ab.enrage.cooldown = rt.enrage.cooldownHits;
    }
  }

  let fragments = 0;
  for (const b of blocks) {
    if (b.remainingHp <= 0 && !b.fragmentsAwarded) {
      const cur = currencyForFamily[b.family];
      if (cur === targetCurrency) {
        fragments += onFragmentBlockBroken(b, economy, staminaRef, maxStamina);
      } else if (cur) {
        onFragmentBlockBroken(b, economy, staminaRef, maxStamina);
      }
    }
  }

  const seconds = 1 / attackSpeedMult(ab, economy);
  if (ab.speedModHits > 0) ab.speedModHits--;
  if (ab.flurry.speedHits > 0) ab.flurry.speedHits--;

  return { hit: true, fragments, seconds };
}

function buildCurrencyForFamily(lookup) {
  const map = {};
  for (const [family, def] of Object.entries(lookup.blocks.families || {})) {
    if (def.fragment_currency) map[family] = def.fragment_currency;
  }
  return map;
}

/** Cached combat/economy for many fragment MC trials on one build. */
function createFragmentRunContext(build, lookup) {
  return {
    combat: computeCombat(build, lookup),
    rt: buildAbilityRuntime(build, lookup),
    economy: buildFragmentEconomy(build, lookup),
    cardCtx: buildCardContext(build, lookup),
    currencyForFamily: buildCurrencyForFamily(lookup),
  };
}

/**
 * One stamina bar: returns target-currency fragments, elapsed seconds, max stage.
 */
function simulateFragmentRun(build, lookup, rng, targetCurrency, ctx) {
  const runCtx = ctx ?? createFragmentRunContext(build, lookup);
  const { combat, rt, economy, cardCtx, currencyForFamily } = runCtx;
  const ab = createXpAbilityState(rt, rng);
  const staminaRef = { current: combat.maxStamina };

  let stamina = staminaRef.current;
  let stage = 1;
  let maxStage = 1;
  let totalFragments = 0;
  let elapsed = 0;
  let blocks = makeFragmentBlocks(stage, rng, lookup, economy, cardCtx);

  while (stamina > 0) {
    if (!blocks.some((b) => b.remainingHp > 0)) {
      stage += 1;
      maxStage = Math.max(maxStage, stage);
      if (stage > 200) break;
      blocks = makeFragmentBlocks(stage, rng, lookup, economy, cardCtx);
      continue;
    }

    tickXpCooldowns(ab);
    staminaRef.current = stamina;
    tryCastXpAbilities(ab, rt, staminaRef, combat.maxStamina);
    stamina = staminaRef.current;

    const result = performFragmentHit(
      blocks,
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
    elapsed += result.seconds;
    stamina = staminaRef.current;
    stamina -= 1;
  }

  maxStage = resolveMaxStage(stage, maxStage, blocks, stamina);
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

return { mulberry32, getSpawnBand, stageScale, tierAtStage, bossLayout, rollSlot, scaledBlockStats, makeBlock, stampInitialHp, stageClearFraction, makeBlocks, pickTarget, applyDamageToBlock, createAbilityState, tickCooldowns, tryCastAbilities, attacksPerStamina, applyQuakeCleave, performHit, resolveMaxStage, createPushRunContext, simulateRun, runMonteCarlo, rollBlockMods, makeXpBlock, makeXpBlocks, createXpAbilityState, attackSpeedMult, tickXpCooldowns, tryCastXpAbilities, xpForBlock, onBlockBroken, onHitBlock, collectNewlyBroken, performXpHit, createXpRunContext, simulateXpRun, percentileOf, binXpHist, runXpMonteCarlo, rollFragmentBlockMods, makeFragmentBlock, makeFragmentBlocks, fragForBlock, onFragmentBlockBroken, performFragmentHit, buildCurrencyForFamily, createFragmentRunContext, simulateFragmentRun, pickFragHistBinWidth, binFragHist, runFragmentMonteCarlo, FAMILIES };
})();

const { runFragmentMonteCarlo, runMonteCarlo, runXpMonteCarlo } = modules["sim"];

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

function scoreBuild(mode, build, mcOpts) {
  if (mode === "xp") {
    return runXpMonteCarlo(build, lookupIndexed, mcOpts).meanXpPerHour;
  }
  if (mode === "fragment") {
    return runFragmentMonteCarlo(build, lookupIndexed, mcOpts).meanFragPerHour;
  }
  return runMonteCarlo(build, lookupIndexed, mcOpts).mean;
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
  }
};
})();
