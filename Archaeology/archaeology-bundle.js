/* Auto-generated — node scripts/bundle-archaeology.cjs */
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
modules["build-report-ui"] = (function() {
const { computeBuildReport } = modules["build"];
function pct(v, digits = 2) {
  return `${(v * 100).toFixed(digits)}%`;
}

/** Match in-game stat display: truncate toward zero at `digits` decimals (not round). */
function truncToDecimals(v, digits = 2) {
  const factor = 10 ** digits;
  return Math.trunc(v * factor) / factor;
}

function mult(v, digits = 2) {
  const t = truncToDecimals(v, digits);
  return `${t.toFixed(digits)}×`;
}

function num(v, digits = 1) {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(digits);
}

function row(label, value) {
  return `<span class="report-k">${label}</span><span class="report-v">${value}</span>`;
}

function formatArmorPen(r) {
  const bonus = r.armorPenPctBonus ?? 0;
  if (bonus <= 0) return num(r.flatPen, 0);
  const base = r.flatPenBase ?? r.flatPen;
  return `${num(r.flatPen, 1)} (${num(base, 0)} + ${pct(bonus)})`;
}

function renderBuildReport(host, build, lookup) {
  if (!host) return;
  if (!lookup) {
    host.innerHTML = '<p class="note">Load game data to see combat stats.</p>';
    return;
  }

  const r = computeBuildReport(build, lookup);
  host.innerHTML = [
    row("Max stamina", num(r.maxStamina, 0)),
    row("Damage", num(r.damage, 0)),
    row("Avg hit (crit)", num(r.avgDamage, 2)),
    row("Armor penetration", formatArmorPen(r)),
    row("Crit chance", pct(r.critChance)),
    row("Crit damage", mult(r.critDamageMult)),
    row("Super crit chance", pct(r.superCritChance)),
    row("Super crit damage", mult(r.superCritDmgMult)),
    row("Ultra crit chance", pct(r.ultraCritChance, 3)),
    row("Ultra crit damage", mult(r.ultraCritDmgMult)),
    row("Ability instacharge", pct(r.abilityInstacharge, 3)),
    row("Exp gain", mult(r.expGainMult)),
    row("Fragment gain", mult(r.fragmentGainMult)),
    row("Exp mod chance", pct(r.expModChance, 3)),
    row("Exp mod gain", mult(r.expModGainMult)),
    row("Loot mod chance", pct(r.lootModChance, 3)),
    row("Loot mod gain", mult(r.lootModGainMult)),
    row("Speed mod chance", pct(r.speedModChance, 3)),
    row("Speed mod gain", `+${num(r.speedModGainHits, 0)} hits`),
    row("Speed mod atk rate", mult(r.speedModAtkRate, 0)),
    row("Stamina mod chance", pct(r.staminaModChance, 3)),
    row("Stamina mod gain", `+${num(r.staminaModGain, 0)}`),
  ].join("");
}

return { pct, truncToDecimals, mult, num, row, formatArmorPen, renderBuildReport };
})();
modules["calculator-state"] = (function() {
/** Bridge to build-store.js (Event Calculator–style persistence). */

function loadBuildSnapshot() {
  const store = window.ArchaeologyStore;
  if (store) return store.getSnapshot();
  return null;
}

function saveBuildSnapshot(snapshot) {
  const store = window.ArchaeologyStore;
  if (!store || !snapshot) return;
  if (snapshot.archaeology_level != null) store.state.archaeology_level = snapshot.archaeology_level;
  if (snapshot.ascension != null) store.state.ascension = snapshot.ascension;
  if (snapshot.highest_stage != null) store.state.highest_stage = snapshot.highest_stage;
  if (snapshot.mc_trials != null) store.state.mc_trials = snapshot.mc_trials;
  if (snapshot.has_block_bonker != null) store.state.has_block_bonker = snapshot.has_block_bonker;
  if (snapshot.stat_levels) Object.assign(store.state.stat_levels, snapshot.stat_levels);
  if (snapshot.levels) Object.assign(store.state.levels, snapshot.levels);
  if (snapshot.upgrade_levels) {
    for (const ups of Object.values(snapshot.upgrade_levels)) {
      for (const [id, lv] of Object.entries(ups)) store.state.levels[id] = lv;
    }
  }
  if (snapshot.gem_levels) {
    for (const [id, lv] of Object.entries(snapshot.gem_levels)) store.state.levels[id] = lv;
  }
  if (snapshot.block_cards && typeof snapshot.block_cards === "object") {
    store.state.block_cards = { ...snapshot.block_cards };
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, "misc_card_quality")) {
    store.state.misc_card_quality = snapshot.misc_card_quality || "";
  }
  store.syncToDom?.();
  store.saveState();
}

function applyBuildSnapshot(saved) {
  const store = window.ArchaeologyStore;
  if (!store || !saved) return;
  store.applySnapshot(saved);
  store.syncToDom();
}

function applyBuildFieldsToDom(saved) {
  applyBuildSnapshot(saved);
}

function applyUpgradeLevelsToDom(saved) {
  applyBuildSnapshot(saved);
}

function readBuildFieldsFromDom(statIds) {
  const store = window.ArchaeologyStore;
  if (store) return store.getSnapshot();
  return {
    archaeology_level: 1,
    ascension: 0,
    highest_stage: 1,
    has_block_bonker: false,
    stat_levels: Object.fromEntries(statIds.map((id) => [id, 0])),
    upgrade_levels: {},
    gem_levels: {},
    mc_trials: 600,
  };
}

function persistFromDom() {
  window.ArchaeologyStore?.saveState();
}

function loadBuildFields() {
  return loadBuildSnapshot();
}

function saveBuildFields(fields) {
  saveBuildSnapshot(fields);
}

return { loadBuildSnapshot, saveBuildSnapshot, applyBuildSnapshot, applyBuildFieldsToDom, applyUpgradeLevelsToDom, readBuildFieldsFromDom, persistFromDom, loadBuildFields, saveBuildFields };
})();
modules["unlock-ui"] = (function() {
/**
 * Gray out stats/upgrades not yet unlocked at current highest stage / ascension.
 */

const { STAT_IDS } = modules["build"];
/** Ascension required per stat (matches lookup.json). Used before lookup loads. */
const STAT_UNLOCK_ASCENSION = {
  strength: 0,
  agility: 0,
  perception: 0,
  intellect: 0,
  luck: 0,
  divinity: 1,
  corruption: 2,
};

function unlockAscensionForStat(id, row, lookup) {
  const raw = row?.getAttribute("data-unlock-ascension");
  if (raw != null && raw !== "") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  const fromLookup = lookup?.stat_points?.stats?.[id]?.unlock?.ascension;
  if (fromLookup != null) return fromLookup;
  return STAT_UNLOCK_ASCENSION[id] ?? 0;
}

/** Per-upgrade unlock stage (matches lookup.json order). Gem = always available. */
const UPGRADE_UNLOCK_STAGE = {
  flat_damage: 1,
  flat_armor_penetration: 2,
  archaeology_exp_gain: 3,
  crit_chance_and_crit_damage: 4,
  strength_stat_buff: 13,
  polychrome_archaeology_card_bonus: 34,
  max_stamina_and_stamina_mod_chance: 5,
  flat_damage_rare: 6,
  loot_mod_multiplier: 6,
  enrage_buff: 7,
  agility_stat_buff: 15,
  perception_stat_buff: 22,
  fragment_gain_multiplier: 36,
  flat_damage_super_crit: 9,
  exp_and_fragment_gain: 10,
  flurry_buff: 11,
  max_stamina_stamina_mod_gain: 12,
  intellect_stat_buff: 24,
  stamina_mod_gain_epic: 38,
  exp_gain_max_stamina_percent: 17,
  armor_pen_ability_cooldown: 18,
  crit_and_super_crit_damage: 20,
  quake_buff: 20,
  all_mod_chances: 40,
  damage_percent_flat_armor_pen: 26,
  super_crit_ultra_crit_chance: 28,
  exp_mod_gain_and_chance: 30,
  instacharge_max_stamina_per_hit: 32,
  exp_gain_2x_stat_caps: 42,
};

function setUpgradeUnlockStagesFromLookup(lookup) {
  if (!lookup?._upgradeById) return;
  for (const [id, def] of Object.entries(lookup._upgradeById)) {
    if (def.fragment_tier === "gem") continue;
    if (def.unlock_stage != null) UPGRADE_UNLOCK_STAGE[id] = def.unlock_stage;
  }
}

function highestStage() {
  const el = document.getElementById("highest-stage");
  if (!el) return 1;
  const v = parseInt(el.value, 10);
  return Number.isFinite(v) && v >= 1 ? v : 1;
}

function ascension() {
  return parseInt(document.getElementById("ascension")?.value, 10) || 0;
}

function unlockStageForUpgrade(el) {
  const raw = el.getAttribute("data-unlock-stage");
  if (raw != null && raw !== "") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  const id = el.getAttribute("data-upgrade-id");
  if (el.getAttribute("data-tier") === "gem") return 0;
  return UPGRADE_UNLOCK_STAGE[id] ?? 999;
}

function setControlsLocked(container, locked) {
  container.querySelectorAll("input.lvl, .btn-step").forEach((ctrl) => {
    ctrl.disabled = locked;
    ctrl.classList.toggle("locked", locked);
    ctrl.setAttribute("aria-disabled", locked ? "true" : "false");
  });
}

function ensureCapMeta(meta) {
  if (!meta.dataset.capText) {
    meta.dataset.capText = (meta.textContent || "").split(" · ")[0].trim();
  }
  return meta.dataset.capText;
}

function updateUpgradeLockStates() {
  if (window.ArchaeologyStore?.applyUpgradeLocks) {
    window.ArchaeologyStore.applyUpgradeLocks();
    return;
  }

  const stage = highestStage();

  for (const el of document.querySelectorAll(".upgrade[data-upgrade-id]")) {
    const tier = el.getAttribute("data-tier");
    if (tier === "gem") continue;
    const need = unlockStageForUpgrade(el);
    const locked = stage < need;

    el.classList.toggle("locked", locked);
    setControlsLocked(el, locked);

    const meta = el.querySelector(".meta");
    if (!meta) continue;
    const capText = ensureCapMeta(meta);
    meta.textContent = locked
      ? `${capText} · Unlocks at stage ${need}`
      : capText;
  }

  for (const panel of document.querySelectorAll(".upgrades-grid > .panel")) {
    const upgrades = panel.querySelectorAll(
      '.upgrade[data-upgrade-id]:not([data-tier="gem"])',
    );
    const anyUnlocked = [...upgrades].some(
      (u) => stage >= unlockStageForUpgrade(u),
    );
    panel.classList.toggle("tier-locked", upgrades.length > 0 && !anyUnlocked);
  }
}

function updateStatLockStates(lookup) {
  const asc = ascension();
  for (const id of STAT_IDS) {
    const row = document.getElementById(`stat-${id}`)?.closest(".stat-slot");
    if (!row) continue;
    const needAsc = unlockAscensionForStat(id, row, lookup);
    const locked = asc < needAsc;
    row.classList.toggle("locked", locked);
    setControlsLocked(row, locked);

    const meta = row.querySelector(".meta");
    if (!meta) continue;
    if (!meta.dataset.capText) {
      meta.dataset.capText = (meta.textContent || "").split(" · ")[0].trim();
    }
    meta.textContent = locked
      ? `${meta.dataset.capText} · Unlocks at ascension ${needAsc}`
      : meta.dataset.capText;
  }
}

let statLookup = null;
let unlockListenersBound = false;

function refreshUnlockUI() {
  updateUpgradeLockStates();
  updateStatLockStates(statLookup);
}

function bindUnlockListeners(lookup) {
  if (lookup != null) statLookup = lookup;

  if (!unlockListenersBound) {
    unlockListenersBound = true;
    const onStageOrAsc = (e) => {
      const id = e.target?.id;
      if (id === "highest-stage" || id === "ascension") refreshUnlockUI();
    };
    document.getElementById("section-build")?.addEventListener("input", onStageOrAsc);
    document.getElementById("section-build")?.addEventListener("change", onStageOrAsc);
    document.getElementById("highest-stage")?.addEventListener("input", refreshUnlockUI);
    document.getElementById("highest-stage")?.addEventListener("change", refreshUnlockUI);
    document.addEventListener("archaeology-build-change", refreshUnlockUI);
  }

  refreshUnlockUI();
}

return { unlockAscensionForStat, setUpgradeUnlockStagesFromLookup, highestStage, ascension, unlockStageForUpgrade, setControlsLocked, ensureCapMeta, updateUpgradeLockStates, updateStatLockStates, refreshUnlockUI, bindUnlockListeners, STAT_UNLOCK_ASCENSION, UPGRADE_UNLOCK_STAGE };
})();
modules["upgrade-ui"] = (function() {
/**
 * Hard-coded upgrade inputs in index.html — bind step buttons and caps.
 */

const { updateUpgradeLockStates } = modules["unlock-ui"];
const GEM_NOMINAL = {
  gem_stamina_and_stamina_mod: 50,
  gem_exp_and_exp_mod: 25,
  gem_fragment_and_loot_mod: 25,
};

function archLevel() {
  return parseInt(document.getElementById("arch-level")?.value, 10) || 1;
}

function fragmentCap(el) {
  const raw = el.dataset.cap;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 999;
}

function gemCap(id) {
  const nominal = GEM_NOMINAL[id] ?? 25;
  return Math.min(nominal, archLevel() + 4);
}

function capForUpgrade(el) {
  const tier = el.dataset.tier;
  const id = el.dataset.upgradeId;
  if (tier === "gem") return gemCap(id);
  return fragmentCap(el);
}

function clampInput(input, cap) {
  const v = Math.max(0, Math.min(cap, Math.floor(parseInt(input.value, 10) || 0)));
  input.value = String(v);
  input.classList.toggle("invalid", v > cap);
  return v;
}

function syncUpgradeLevelFromDom(upgradeEl) {
  const store = window.ArchaeologyStore;
  const id = upgradeEl?.dataset?.upgradeId;
  const input = upgradeEl?.querySelector("input.lvl");
  if (!store || !id || !input) return;
  if (!Object.prototype.hasOwnProperty.call(store.state.levels, id)) {
    store.state.levels[id] = 0;
  }
  const v = Math.max(0, Math.floor(parseInt(input.value, 10) || 0));
  store.state.levels[id] = v;
}

function emitBuildChange() {
  window.ArchaeologyStore?.saveState();
  document.dispatchEvent(new CustomEvent("archaeology-build-change"));
}

function updateGemCapLabels() {
  for (const el of document.querySelectorAll('.upgrade[data-tier="gem"]')) {
    const id = el.dataset.upgradeId;
    const cap = gemCap(id);
    const meta = el.querySelector(".meta");
    if (meta) {
      const nominal = GEM_NOMINAL[id] ?? 25;
      const capText =
        cap >= nominal ? `Cap: ${nominal}` : `Cap: ${cap} (max ${nominal})`;
      meta.dataset.capText = capText;
      meta.textContent = capText;
    }
    const input = document.getElementById(`lvl_${id}`);
    if (input) clampInput(input, cap);
  }
}

function bindUpgradePanel() {
  const build = document.getElementById("section-build");
  if (!build) return;

  build.addEventListener("click", (e) => {
    const btn = e.target.closest(".upgrade .btn-step[data-delta]");
    if (!btn || btn.disabled) return;
    const upgrade = btn.closest(".upgrade");
    if (upgrade?.classList.contains("locked")) return;
    const input = upgrade?.querySelector("input.lvl");
    if (!input) return;
    const delta = parseInt(btn.dataset.delta, 10) || 0;
    const cap = capForUpgrade(upgrade);
    const next = Math.max(0, Math.min(cap, (parseInt(input.value, 10) || 0) + delta));
    input.value = String(next);
    input.classList.toggle("invalid", next > cap);
    syncUpgradeLevelFromDom(upgrade);
    emitBuildChange();
  });

  for (const el of document.querySelectorAll(".upgrade[data-upgrade-id]")) {
    const input = el.querySelector("input.lvl");
    if (!input) continue;
    input.addEventListener("input", () => {
      if (el.classList.contains("locked")) return;
      const cap = capForUpgrade(el);
      clampInput(input, cap);
      syncUpgradeLevelFromDom(el);
      emitBuildChange();
    });
    input.addEventListener("blur", () => {
      if (input.value.trim() === "") input.value = "0";
      clampInput(input, capForUpgrade(el));
      syncUpgradeLevelFromDom(el);
      emitBuildChange();
    });
  }

  document.getElementById("arch-level")?.addEventListener("input", () => {
    updateGemCapLabels();
    emitBuildChange();
  });
  document.getElementById("arch-level")?.addEventListener("change", () => {
    updateGemCapLabels();
    emitBuildChange();
  });
}

function initUpgradeUI() {
  bindUpgradePanel();
  updateGemCapLabels();
  updateUpgradeLockStates();
  for (const el of document.querySelectorAll(".upgrade[data-upgrade-id]")) {
    const input = el.querySelector("input.lvl");
    if (input) {
      clampInput(input, capForUpgrade(el));
      syncUpgradeLevelFromDom(el);
    }
  }
}

function getUpgradeLevelsByTier() {
  const snap = window.ArchaeologyStore?.getSnapshot();
  if (snap?.upgrade_levels) return snap.upgrade_levels;
  const out = { common: {}, rare: {}, epic: {}, legendary: {}, mythic: {} };
  for (const el of document.querySelectorAll(".upgrade[data-upgrade-id]")) {
    const tier = el.dataset.tier;
    if (tier === "gem" || !out[tier]) continue;
    const id = el.dataset.upgradeId;
    out[tier][id] = parseInt(document.getElementById(`lvl_${id}`)?.value, 10) || 0;
  }
  return out;
}

function getGemLevels() {
  const snap = window.ArchaeologyStore?.getSnapshot();
  if (snap?.gem_levels) return snap.gem_levels;
  const gem = {};
  for (const el of document.querySelectorAll('.upgrade[data-tier="gem"]')) {
    const id = el.dataset.upgradeId;
    gem[id] = parseInt(document.getElementById(`lvl_${id}`)?.value, 10) || 0;
  }
  return gem;
}

return { archLevel, fragmentCap, gemCap, capForUpgrade, clampInput, syncUpgradeLevelFromDom, emitBuildChange, updateGemCapLabels, bindUpgradePanel, initUpgradeUI, getUpgradeLevelsByTier, getGemLevels, GEM_NOMINAL };
})();
modules["ui-controls"] = (function() {
/** Shared input-block + step buttons; numeric focus wired by build-store.js */

function appendStepControls(input, apply) {
  const controls = document.createElement("div");
  controls.className = "lvl-controls";
  const mk = (d, label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-step";
    b.textContent = label;
    b.addEventListener("click", () => apply(d));
    return b;
  };
  controls.appendChild(mk(-5, "−5"));
  controls.appendChild(mk(-1, "−1"));
  controls.appendChild(input);
  controls.appendChild(mk(1, "+1"));
  controls.appendChild(mk(5, "+5"));
  return controls;
}

function wireStoreInputOnce(input, stateKey) {
  const store = window.ArchaeologyStore;
  if (!store || !input || input.dataset.storeWired === "1") return;
  if (stateKey) {
    store.wireNumericInput(input, (v) => {
      store.state[stateKey] = v;
      if (stateKey === "archaeology_level") store.applyBudgetLine?.();
      if (stateKey === "highest_stage") store.applyUpgradeLocks?.();
    });
  } else {
    store.wireNumericInput(input, () => {});
  }
}

function bindInputBlock(inputId, options = {}) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const block = input.closest(".input-block");
  if (!block) return;

  const stateKeyMap = {
    "arch-level": "archaeology_level",
    "ascension": "ascension",
    "highest-stage": "highest_stage",
    "mc-trials": "mc_trials",
  };

  const { min = 0, max = Infinity, integer = true, onChange } = options;
  block.querySelector(".lvl-controls")?.remove();

  input.classList.add("lvl");
  if (!input.classList.contains("scalar")) input.classList.add("scalar");

  const apply = (delta) => {
    const raw = parseFloat(input.value) || 0;
    const v = Math.max(min, Math.min(max, raw + delta));
    input.value = String(integer ? Math.floor(v) : v);
    const key = stateKeyMap[inputId];
    if (key && window.ArchaeologyStore) {
      window.ArchaeologyStore.state[key] = parseInt(input.value, 10) || 0;
      if (key === "archaeology_level") window.ArchaeologyStore.applyBudgetLine?.();
      if (key === "highest_stage") window.ArchaeologyStore.applyUpgradeLocks?.();
    }
    window.ArchaeologyStore?.saveState();
    onChange?.();
    document.dispatchEvent(new CustomEvent("archaeology-build-change"));
  };

  block.appendChild(appendStepControls(input, apply));
  wireStoreInputOnce(input, stateKeyMap[inputId]);
  window.ArchaeologyStore?.applyUpgradeLocks?.();
}

function bindStatStepDelegation(getCap) {
  const host = document.getElementById("statInputs");
  if (!host || host.dataset.statDelegateBound === "1") return;
  host.dataset.statDelegateBound = "1";

  host.addEventListener("click", (e) => {
    const btn = e.target.closest(".stat-slot .btn-step[data-delta]");
    if (!btn || btn.disabled) return;
    const row = btn.closest(".stat-slot");
    if (!row || row.classList.contains("locked")) return;
    const id = row.dataset.statId;
    const input = row.querySelector("input.lvl");
    if (!id || !input) return;

    const delta = parseInt(btn.dataset.delta, 10) || 0;
    const cap = getCap(id);
    const next = Math.max(0, Math.min(cap, (parseInt(input.value, 10) || 0) + delta));
    input.value = String(next);
    input.classList.toggle("invalid", next > cap);
    if (window.ArchaeologyStore) window.ArchaeologyStore.state.stat_levels[id] = next;
    window.ArchaeologyStore?.saveState();
    document.dispatchEvent(new CustomEvent("archaeology-build-change"));
  });
}

function bindStatInputs(statIds, getCap) {
  bindStatStepDelegation(getCap);

  for (const id of statIds) {
    const input = document.getElementById(`stat-${id}`);
    if (!input) continue;
    const row = input.closest(".stat-slot");
    if (!row) continue;

    const apply = (delta) => {
      if (row.classList.contains("locked")) return;
      const cap = getCap(id);
      const next = Math.max(0, Math.min(cap, (parseInt(input.value, 10) || 0) + delta));
      input.value = String(next);
      input.classList.toggle("invalid", next > cap);
      if (window.ArchaeologyStore) window.ArchaeologyStore.state.stat_levels[id] = next;
      window.ArchaeologyStore?.saveState();
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    };

    input.classList.add("lvl");
    if (!row.querySelector(".lvl-controls .btn-step[data-delta]")) {
      row.querySelector(".lvl-controls")?.remove();
      const top = row.querySelector(".upgrade-top") || row;
      const controlsHost = top.querySelector(".lvl-controls")
        ? top
        : (() => {
            const wrap = document.createElement("div");
            wrap.className = "upgrade-top";
            const list = document.createElement("div");
            list.className = "benefit-list";
            const line = document.createElement("span");
            line.className = "benefit-line";
            line.textContent = id.charAt(0).toUpperCase() + id.slice(1);
            list.appendChild(line);
            wrap.appendChild(list);
            row.appendChild(wrap);
            return wrap;
          })();
      const controls = appendStepControls(input, apply);
      if (top.querySelector(".benefit-list")) {
        top.appendChild(controls);
      } else {
        controlsHost.appendChild(controls);
      }
    }

    const store = window.ArchaeologyStore;
    if (store && input.dataset.storeWired !== "1") {
      store.wireNumericInput(input, (v) => {
        if (row.classList.contains("locked")) return;
        const cap = getCap(id);
        const clamped = Math.max(0, Math.min(cap, v));
        if (clamped !== v) input.value = String(clamped);
        store.state.stat_levels[id] = clamped;
        input.classList.toggle("invalid", clamped > cap);
        store.applyBudgetLine?.();
      });
    }

    const onValidate = () => {
      if (row.classList.contains("locked")) return;
      const cap = getCap(id);
      const v = parseInt(input.value, 10) || 0;
      input.classList.toggle("invalid", v > cap);
    };
    input.addEventListener("input", onValidate);
    input.addEventListener("blur", () => {
      if (row.classList.contains("locked")) return;
      const cap = getCap(id);
      const v = Math.max(0, Math.min(cap, parseInt(input.value, 10) || 0));
      input.value = String(v);
      if (window.ArchaeologyStore) window.ArchaeologyStore.state.stat_levels[id] = v;
      window.ArchaeologyStore?.saveState();
      onValidate();
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    });
  }
}

return { appendStepControls, wireStoreInputOnce, bindInputBlock, bindStatStepDelegation, bindStatInputs };
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
modules["mc-worker-pool"] = (function() {
/**
 * Web Worker pool for parallel Monte Carlo scoring (optimizer phases).
 */

const { STAT_IDS } = modules["build"];
const { runFragmentMonteCarlo, runMonteCarlo, runXpMonteCarlo } = modules["sim"];
function statsKey(sl) {
  return STAT_IDS.map((id) => sl[id] || 0).join(",");
}

let poolPromise = null;
let poolLookupRef = null;

function workerScriptUrl() {
  if (typeof document !== "undefined" && document.baseURI) {
    try {
      return new URL("js/mc-worker.js", document.baseURI).href;
    } catch (e) {
      /* ignore */
    }
  }
  return "js/mc-worker.js";
}

function defaultPoolSize() {
  if (typeof navigator === "undefined") return 1;
  const hc = navigator.hardwareConcurrency || 4;
  return Math.min(8, Math.max(1, hc - 1));
}

function scoreOnMainThread(mode, build, lookup, mcOpts) {
  if (mode === "xp") {
    return runXpMonteCarlo(build, lookup, mcOpts).meanXpPerHour;
  }
  if (mode === "fragment") {
    return runFragmentMonteCarlo(build, lookup, mcOpts).meanFragPerHour;
  }
  return runMonteCarlo(build, lookup, mcOpts).mean;
}

class McWorkerPool {
  constructor(lookup, size) {
    this.lookup = lookup;
    this.size = size;
    this.workers = [];
    this.ready = new Set();
    this.fatal = false;
    this.jobQueue = [];
    this.inFlight = 0;
    this._readyPromise = null;
  }

  static workersSupported() {
    return typeof Worker !== "undefined" && typeof Promise !== "undefined";
  }

  async init() {
    if (!McWorkerPool.workersSupported()) {
      this.fatal = true;
      return false;
    }
    const url = workerScriptUrl();
    this._readyPromise = new Promise((resolve, reject) => {
      const lookupPayload = JSON.parse(JSON.stringify(this.lookup));
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.fatal = true;
        this.terminate();
        reject(new Error("MC worker init timed out"));
      }, 30000);

      const onReady = () => {
        if (this.ready.size < this.size) return;
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(true);
      };

      for (let i = 0; i < this.size; i++) {
        let w;
        try {
          w = new Worker(url);
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.fatal = true;
            reject(err);
          }
          return;
        }
        w.onmessage = (ev) => this._onMessage(w, ev);
        w.onerror = () => {
          this.fatal = true;
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error("MC worker failed to load"));
          }
        };
        this.workers.push(w);
        w.postMessage({ type: "init", lookup: lookupPayload, workerId: i });
      }

      this._resolveReady = onReady;
    });

    try {
      await this._readyPromise;
      return true;
    } catch {
      this.fatal = true;
      this.terminate();
      return false;
    }
  }

  _onMessage(worker, ev) {
    const msg = ev.data || {};
    if (msg.type === "ready") {
      this.ready.add(worker);
      this._resolveReady?.();
      return;
    }
    if (msg.type === "result") {
      const job = worker._currentJob;
      worker._currentJob = null;
      this.inFlight--;
      if (job) {
        if (msg.error) job.reject(new Error(msg.error));
        else job.resolve(msg.score);
      }
      this._pump();
    }
  }

  _pump() {
    while (this.inFlight < this.workers.length && this.jobQueue.length > 0) {
      const worker = this.workers.find((w) => w._currentJob == null);
      if (!worker) break;
      const job = this.jobQueue.shift();
      worker._currentJob = job;
      this.inFlight++;
      worker.postMessage({
        type: "eval",
        id: job.id,
        mode: job.mode,
        build: job.build,
        mcOpts: job.mcOpts,
      });
    }
  }

  evaluate(job) {
    return new Promise((resolve, reject) => {
      this.jobQueue.push({ ...job, resolve, reject });
      this._pump();
    });
  }

  terminate() {
    for (const w of this.workers) {
      try {
        w.terminate();
      } catch (e) {
        /* ignore */
      }
    }
    this.workers = [];
    this.ready.clear();
  }
}

async function getPool(lookup, poolSize) {
  if (poolPromise && poolLookupRef === lookup) {
    return poolPromise;
  }
  if (poolPromise) {
    const old = await poolPromise.catch(() => null);
    old?.terminate?.();
    poolPromise = null;
  }
  poolLookupRef = lookup;
  const pool = new McWorkerPool(lookup, poolSize ?? defaultPoolSize());
  poolPromise = (async () => {
    const ok = await pool.init();
    if (!ok) pool.fatal = true;
    return pool;
  })();
  return poolPromise;
}

function resetMcWorkerPool() {
  if (poolPromise) {
    poolPromise.then((p) => p?.terminate?.()).catch(() => {});
  }
  poolPromise = null;
  poolLookupRef = null;
}

/**
 * Score many stat allocations in parallel (uses cache, then worker pool or main thread).
 * @param {string} mode — "push" | "xp" | "fragment"
 * @returns {Map<string, number>} statsKey → score
 */
async function evaluateAllocationsBatch(
  baseBuild,
  lookup,
  items,
  mcOpts,
  mode,
  cache,
  { parallel = true, poolSize } = {},
) {
  const out = new Map();
  const pending = [];

  for (const item of items) {
    const key = item.key ?? statsKey(item.sl);
    if (cache?.has(key)) {
      out.set(key, cache.get(key));
      continue;
    }
    pending.push({ key, sl: item.sl, tag: item.tag });
  }

  if (!pending.length) return out;

  const runSequential = () => {
    for (const { key, sl } of pending) {
      const trialBuild = { ...baseBuild, stat_levels: { ...sl } };
      const score = scoreOnMainThread(mode, trialBuild, lookup, mcOpts);
      cache?.set(key, score);
      out.set(key, score);
    }
    return out;
  };

  if (!parallel || pending.length < 2) {
    return runSequential();
  }

  let pool;
  try {
    pool = await getPool(lookup, poolSize);
  } catch {
    return runSequential();
  }

  if (!pool || pool.fatal) {
    return runSequential();
  }

  const jobs = pending.map(({ key, sl }) => {
    const trialBuild = { ...baseBuild, stat_levels: { ...sl } };
    return pool
      .evaluate({
        id: key,
        mode,
        build: trialBuild,
        mcOpts,
      })
      .then((score) => {
        cache?.set(key, score);
        out.set(key, score);
      });
  });

  try {
    await Promise.all(jobs);
  } catch (err) {
    console.warn("MC worker batch failed, falling back to main thread:", err);
    pool.fatal = true;
    pool.terminate();
    poolPromise = null;
    for (const { key, sl } of pending) {
      if (out.has(key)) continue;
      const trialBuild = { ...baseBuild, stat_levels: { ...sl } };
      const score = scoreOnMainThread(mode, trialBuild, lookup, mcOpts);
      cache?.set(key, score);
      out.set(key, score);
    }
  }

  return out;
}

function resolveMcPoolSize(requested) {
  if (requested != null && requested > 0) return Math.min(16, Math.floor(requested));
  return defaultPoolSize();
}

return { getPool, evaluateAllocationsBatch, statsKey, workerScriptUrl, defaultPoolSize, scoreOnMainThread, resetMcWorkerPool, resolveMcPoolSize };
})();
modules["stat-optimizer-core"] = (function() {
/**
 * Coarse-to-fine stat allocation search.
 * Phase 1: many candidates × small MC. Phase 2: hill-climb top seeds. Phase 3: confirm finalists.
 */

const {
  STAT_IDS,
  clampStatLevels,
  statCap,
  totalStatBudget,
  sumAllocated,
} = modules["build"];
const { mulberry32 } = modules["sim"];
const {
  evaluateAllocationsBatch,
  resolveMcPoolSize,
} = modules["mc-worker-pool"];
function unlocked(statId, build, lookup) {
  return statCap(statId, build, lookup) > 0;
}

function activeStats(build, lookup) {
  return STAT_IDS.filter((id) => unlocked(id, build, lookup));
}

function statsKey(sl) {
  return STAT_IDS.map((id) => sl[id] || 0).join(",");
}

function cloneStats(sl, build, lookup) {
  return clampStatLevels(
    Object.fromEntries(STAT_IDS.map((id) => [id, sl[id] || 0])),
    build,
    lookup,
  );
}

function canIncrease(statId, sl, build, lookup) {
  return (sl[statId] || 0) < statCap(statId, build, lookup);
}

/** Spend `count` points using round-robin on `order`, respecting caps. */
function allocateRoundRobin(sl, build, lookup, order, count) {
  const active = order.filter((id) => unlocked(id, build, lookup));
  if (!active.length || count <= 0) return 0;
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * active.length * 4) {
    guard++;
    let progressed = false;
    for (const id of active) {
      if (placed >= count) break;
      if (!canIncrease(id, sl, build, lookup)) continue;
      sl[id] = (sl[id] || 0) + 1;
      placed++;
      progressed = true;
    }
    if (!progressed) break;
  }
  return placed;
}

/** Fill all spare points into one stat, then sweep others. */
function seedSinglePriority(sl, build, lookup, priority, active) {
  let allocated = sumAllocated(sl);
  const budget = totalStatBudget(build);
  while (allocated < budget && canIncrease(priority, sl, build, lookup)) {
    sl[priority] = (sl[priority] || 0) + 1;
    allocated++;
  }
  const rest = active.filter((id) => id !== priority);
  allocateRoundRobin(sl, build, lookup, rest, budget - sumAllocated(sl));
}

/** Proportional template scaled to budget (respects caps iteratively). */
function seedFromWeights(sl, build, lookup, weights, active) {
  const budget = totalStatBudget(build);
  const wSum = active.reduce((s, id) => s + (weights[id] || 0), 0) || 1;
  const target = {};
  let floored = 0;
  for (const id of active) {
    const t = Math.floor((budget * (weights[id] || 0)) / wSum);
    target[id] = t;
    floored += t;
  }
  let left = budget - floored;
  const byFrac = active
    .map((id) => ({
      id,
      frac: (budget * (weights[id] || 0)) / wSum - target[id],
    }))
    .sort((a, b) => b.frac - a.frac);
  for (const { id } of byFrac) {
    if (left <= 0) break;
    target[id] = (target[id] || 0) + 1;
    left--;
  }
  for (const id of active) {
    sl[id] = Math.min(statCap(id, build, lookup), target[id] || 0);
  }
  allocateRoundRobin(sl, build, lookup, active, budget - sumAllocated(sl));
}

function randomAllocation(rng, build, lookup, active) {
  const sl = Object.fromEntries(active.map((id) => [id, 0]));
  const budget = totalStatBudget(build);
  const order = [...active].sort(() => rng() - 0.5);
  allocateRoundRobin(sl, build, lookup, order, budget);
  return clampStatLevels(sl, build, lookup);
}

/** All points into `focusIds` first (round-robin within group), then spill to the rest. */
function seedSpikeFocus(sl, build, lookup, focusIds, active) {
  const budget = totalStatBudget(build);
  const focus = focusIds.filter((id) => active.includes(id));
  const rest = active.filter((id) => !focus.includes(id));
  let allocated = sumAllocated(sl);
  let guard = 0;
  while (allocated < budget && focus.length && guard < budget * focus.length * 4) {
    guard++;
    let progressed = false;
    for (const id of focus) {
      if (allocated >= budget) break;
      if (!canIncrease(id, sl, build, lookup)) continue;
      sl[id] = (sl[id] || 0) + 1;
      allocated++;
      progressed = true;
    }
    if (!progressed) break;
  }
  allocateRoundRobin(sl, build, lookup, rest, budget - sumAllocated(sl));
}

function combinations(arr, k) {
  const out = [];
  function pick(start, combo) {
    if (combo.length === k) {
      out.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      pick(i + 1, [...combo, arr[i]]);
    }
  }
  pick(0, []);
  return out;
}

/** 1-high, 2-high, 3-high spike layouts (rest minimal until caps force spill). */
function addSpikeProfileCandidates(push, build, lookup, active, options) {
  if (options.spikeProfiles === false) return;

  const includeTriple = options.spikeTriple !== false;

  for (const id of active) {
    const sl = Object.fromEntries(active.map((s) => [s, 0]));
    seedSpikeFocus(sl, build, lookup, [id], active);
    push(sl, `spike1_${id}`);
  }

  for (const pair of combinations(active, 2)) {
    const sl = Object.fromEntries(active.map((s) => [s, 0]));
    seedSpikeFocus(sl, build, lookup, pair, active);
    push(sl, `spike2_${pair.join("_")}`);
  }

  if (includeTriple && active.length >= 3) {
    for (const triple of combinations(active, 3)) {
      const sl = Object.fromEntries(active.map((s) => [s, 0]));
      seedSpikeFocus(sl, build, lookup, triple, active);
      push(sl, `spike3_${triple.join("_")}`);
    }
  }
}

function normalizeUserSeed(build, lookup, active) {
  const budget = totalStatBudget(build);
  const sl = cloneStats(build.stat_levels || {}, build, lookup);
  let sum = sumAllocated(sl);
  if (sum > budget) {
    while (sum > budget) {
      const donor = active
        .filter((id) => (sl[id] || 0) > 0)
        .sort((a, b) => (sl[b] || 0) - (sl[a] || 0))[0];
      if (!donor) break;
      sl[donor]--;
      sum--;
    }
  } else {
    allocateRoundRobin(sl, build, lookup, active, budget - sum);
  }
  return sl;
}

/**
 * @param {object} options — { profiles, randomSamples }
 */
function buildCandidateAllocations(build, lookup, options = {}) {
  const active = activeStats(build, lookup);
  const budget = totalStatBudget(build);
  const candidates = [];
  const seen = new Set();

  const push = (sl, tag) => {
    const c = clampStatLevels(sl, build, lookup);
    if (sumAllocated(c) !== budget) return;
    const key = statsKey(c);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ sl: c, tag });
  };

  push(normalizeUserSeed(build, lookup, active), "your_build");

  const profiles = options.profiles || [];
  for (const [i, weights] of profiles.entries()) {
    const sl = Object.fromEntries(active.map((id) => [id, 0]));
    seedFromWeights(sl, build, lookup, weights, active);
    push(sl, `profile_${i}`);
  }

  addSpikeProfileCandidates(push, build, lookup, active, options);

  for (const priority of options.prioritySeeds || []) {
    if (!active.includes(priority)) continue;
    const sl = Object.fromEntries(active.map((id) => [id, 0]));
    seedSinglePriority(sl, build, lookup, priority, active);
    push(sl, `max_${priority}`);
  }

  const fillOrder = options.fillOrder || active;
  {
    const sl = Object.fromEntries(active.map((id) => [id, 0]));
    allocateRoundRobin(sl, build, lookup, fillOrder, budget);
    push(sl, "even_spread");
  }

  const rng = mulberry32((options.seed ?? 90210) + 777);
  const randomN =
    options.randomSamples ??
    Math.min(48, Math.max(20, Math.floor(budget * 1.2)));
  for (let i = 0; i < randomN; i++) {
    push(randomAllocation(rng, build, lookup, active), `random_${i}`);
  }

  return candidates;
}

function evaluateAllocation(
  sl,
  build,
  lookup,
  mcOpts,
  cache,
  evaluateFn,
) {
  const key = statsKey(sl);
  if (cache.has(key)) return cache.get(key);
  const trialBuild = { ...build, stat_levels: { ...sl } };
  const score = evaluateFn(trialBuild, lookup, mcOpts);
  cache.set(key, score);
  return score;
}

async function hillClimbFrom(
  startSl,
  build,
  lookup,
  mcOpts,
  evaluateFn,
  cache,
  {
    maxIter = 200,
    evaluateMode = "push",
    parallel = true,
    onProgress,
    yieldEvery = 2,
  } = {},
) {
  const active = activeStats(build, lookup);
  const sl = cloneStats(startSl, build, lookup);
  let bestMean = evaluateAllocation(sl, build, lookup, mcOpts, cache, evaluateFn);
  let improved = true;
  let iterations = 0;
  const useParallel = parallel !== false && evaluateMode;

  while (improved && iterations < maxIter) {
    improved = false;
    iterations++;
    if (onProgress && (iterations === 1 || iterations % yieldEvery === 0)) {
      onProgress({ iteration: iterations, maxIter, bestMean });
      await new Promise((r) => setTimeout(r, 0));
    }
    const proposals = [];
    const trial = cloneStats(sl, build, lookup);

    for (const from of active) {
      if ((trial[from] || 0) <= 0) continue;
      for (const to of active) {
        if (from === to || !canIncrease(to, trial, build, lookup)) continue;
        const cand = cloneStats(trial, build, lookup);
        cand[from]--;
        cand[to] = (cand[to] || 0) + 1;
        proposals.push({ sl: cand, from, to });
      }
    }

    let scores;
    if (useParallel && proposals.length > 1) {
      scores = await evaluateAllocationsBatch(
        build,
        lookup,
        proposals,
        mcOpts,
        evaluateMode,
        cache,
        { parallel, poolSize: mcOpts.poolSize },
      );
    } else {
      scores = new Map();
      for (const p of proposals) {
        const key = statsKey(p.sl);
        scores.set(
          key,
          evaluateAllocation(p.sl, build, lookup, mcOpts, cache, evaluateFn),
        );
      }
    }

    let bestMove = null;
    let bestMoveScore = bestMean;
    for (const p of proposals) {
      const mean = scores.get(statsKey(p.sl));
      if (mean > bestMoveScore + 1e-6) {
        bestMoveScore = mean;
        bestMove = p;
      }
    }

    if (bestMove) {
      sl[bestMove.from]--;
      sl[bestMove.to] = (sl[bestMove.to] || 0) + 1;
      bestMean = bestMoveScore;
      improved = true;
    }
  }

  return {
    stat_levels: clampStatLevels(sl, build, lookup),
    score: bestMean,
    iterations,
  };
}

/**
 * @param {function} evaluateFn — (build, lookup, mcOpts) => number score
 * @param {function} [finalEvaluateFn] — optional full MC for winner
 */
async function coarseToFineOptimize(
  build,
  lookup,
  mcOpts,
  evaluateFn,
  options = {},
  onProgress,
  finalEvaluateFn,
) {
  const budget = totalStatBudget(build);
  const reportTrials = mcOpts.reportTrials ?? mcOpts.trials ?? 600;
  const coarseTrials =
    mcOpts.coarseTrials ?? Math.min(150, Math.max(60, Math.floor(reportTrials / 5)));
  const refineTrials =
    mcOpts.refineTrials ??
    mcOpts.trials ??
    Math.max(200, Math.min(reportTrials, Math.floor(reportTrials * 0.75)));
  const topK = options.topK ?? 8;
  const finalists = options.finalists ?? 3;
  const baseSeed = mcOpts.seed ?? 1;
  const evaluateMode = options.evaluateMode ?? "push";
  const parallel = options.parallel !== false;
  const poolSize = resolveMcPoolSize(mcOpts.poolSize ?? options.poolSize);

  const candidates = buildCandidateAllocations(build, lookup, options);
  const cache = new Map();
  const coarseOpts = {
    ...mcOpts,
    trials: coarseTrials,
    seed: baseSeed,
    poolSize,
    scoreOnly: true,
  };

  onProgress?.({
    phase: "coarse",
    index: 0,
    total: candidates.length,
    bestMean: 0,
    tag: parallel ? `parallel (${poolSize} workers)` : "sequential",
  });
  if (onProgress) await new Promise((r) => setTimeout(r, 0));

  const coarseScores = await evaluateAllocationsBatch(
    build,
    lookup,
    candidates.map((c) => ({ sl: c.sl, key: statsKey(c.sl), tag: c.tag })),
    coarseOpts,
    evaluateMode,
    cache,
    { parallel, poolSize },
  );

  const scored = candidates.map((c) => ({
    ...c,
    coarseScore: coarseScores.get(statsKey(c.sl)) ?? 0,
  }));

  onProgress?.({
    phase: "coarse",
    index: candidates.length,
    total: candidates.length,
    bestMean: Math.max(...scored.map((s) => s.coarseScore)),
    tag: "done",
  });
  if (onProgress) await new Promise((r) => setTimeout(r, 0));

  scored.sort((a, b) => b.coarseScore - a.coarseScore);
  const seeds = scored.slice(0, topK);
  const refineOpts = {
    ...mcOpts,
    trials: refineTrials,
    seed: baseSeed + 17,
    scoreOnly: true,
  };
  let best = { stat_levels: seeds[0].sl, score: seeds[0].coarseScore, iterations: 0 };

  onProgress?.({
    phase: "refine",
    index: 0,
    total: seeds.length,
    bestMean: best.score,
    tag: "starting",
  });
  if (onProgress) await new Promise((r) => setTimeout(r, 0));

  const refineConcurrency = Math.max(1, options.refineConcurrency ?? 1);
  let refineDone = 0;

  async function refineOneSeed(seed, j) {
    const refined = await hillClimbFrom(
      seed.sl,
      build,
      lookup,
      refineOpts,
      evaluateFn,
      cache,
      {
        maxIter: options.hillClimbMaxIter ?? 200,
        evaluateMode,
        parallel,
        onProgress: onProgress
          ? (p) =>
              onProgress({
                phase: "refine",
                index: j,
                total: seeds.length,
                bestMean: Math.max(best.score, p.bestMean),
                tag: seed.tag,
                hillIter: p.iteration,
                hillMax: p.maxIter,
              })
          : undefined,
      },
    );
    refineDone += 1;
    if (refined.score > best.score) best = refined;
    onProgress?.({
      phase: "refine",
      index: refineDone,
      total: seeds.length,
      iterations: refined.iterations,
      bestMean: Math.max(best.score, refined.score),
      tag: seed.tag,
    });
    if (onProgress) await new Promise((r) => setTimeout(r, 0));
    return refined;
  }

  if (refineConcurrency <= 1) {
    for (let j = 0; j < seeds.length; j++) {
      onProgress?.({
        phase: "refine",
        index: j,
        total: seeds.length,
        bestMean: best.score,
        tag: seeds[j].tag,
      });
      if (onProgress) await new Promise((r) => setTimeout(r, 0));
      await refineOneSeed(seeds[j], j);
    }
  } else {
    const queue = seeds.map((seed, j) => ({ seed, j }));
    const workers = Array.from(
      { length: Math.min(refineConcurrency, seeds.length) },
      async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          await refineOneSeed(next.seed, next.j);
        }
      },
    );
    await Promise.all(workers);
  }

  const uniqueFinal = [];
  const seenF = new Set();
  const addFinal = (sl) => {
    const c = clampStatLevels(sl, build, lookup);
    const k = statsKey(c);
    if (seenF.has(k)) return;
    seenF.add(k);
    uniqueFinal.push({ sl: c });
  };
  addFinal(best.stat_levels);
  for (const s of seeds) addFinal(s.sl);
  for (const s of scored) {
    if (uniqueFinal.length >= finalists) break;
    addFinal(s.sl);
  }

  const confirmOpts = {
    ...mcOpts,
    trials: reportTrials,
    seed: baseSeed + 99,
    scoreOnly: true,
  };
  const finalMcOpts = {
    ...mcOpts,
    trials: reportTrials,
    seed: baseSeed + 99,
    scoreOnly: false,
  };
  let winner = best;
  let finalMc = null;

  if (finalEvaluateFn) {
    const finalItems = uniqueFinal.map((u) => ({
      sl: clampStatLevels(u.sl, build, lookup),
    }));
    const confirmScores = await evaluateAllocationsBatch(
      build,
      lookup,
      finalItems,
      confirmOpts,
      evaluateMode,
      cache,
      { parallel, poolSize },
    );

    for (let i = 0; i < finalItems.length; i++) {
      const sl = finalItems[i].sl;
      const key = statsKey(sl);
      const score = confirmScores.get(key) ?? 0;
      onProgress?.({
        phase: "final",
        index: i + 1,
        total: finalItems.length,
        bestMean: Math.max(winner.score, score),
      });
      if (score > winner.score) {
        winner = { stat_levels: sl, score, iterations: best.iterations };
        finalMc = null;
      }
    }
    onProgress?.({
      phase: "final",
      index: finalItems.length,
      total: finalItems.length + 1,
      bestMean: winner.score,
      tag: "full-report",
    });
    if (onProgress) await new Promise((r) => setTimeout(r, 0));

    const trialBuild = { ...build, stat_levels: winner.stat_levels };
    const fin = await new Promise((resolve) => {
      setTimeout(() => resolve(finalEvaluateFn(trialBuild, lookup, finalMcOpts)), 0);
    });
    winner.score = fin.score;
    finalMc = fin.mc;
  }

  return {
    stat_levels: winner.stat_levels,
    expectedScore: winner.score,
    mc: finalMc,
    iterations: best.iterations,
    budget,
    candidatesScreened: candidates.length,
    coarseTrials,
    refineTrials,
    mcPoolSize: poolSize,
    mcParallel: parallel,
  };
}

return { hillClimbFrom, coarseToFineOptimize, unlocked, activeStats, statsKey, cloneStats, canIncrease, allocateRoundRobin, seedSinglePriority, seedFromWeights, randomAllocation, seedSpikeFocus, combinations, addSpikeProfileCandidates, normalizeUserSeed, buildCandidateAllocations, evaluateAllocation };
})();
modules["push-optimizer"] = (function() {
/**
 * Allocate stat points to maximize E[max stage] (MC).
 * Coarse candidate screen → hill-climb top seeds → confirm finalists.
 */

const { coarseToFineOptimize } = modules["stat-optimizer-core"];
const { runMonteCarlo } = modules["sim"];
function pushEvaluate(build, lookup, mcOpts) {
  return runMonteCarlo(build, lookup, mcOpts).mean;
}

function pushFinalEvaluate(build, lookup, mcOpts) {
  const mc = runMonteCarlo(build, lookup, mcOpts);
  return { score: mc.mean, mc };
}

function pushOptions(mcOpts) {
  return {
    seed: mcOpts.seed ?? 12345,
    evaluateMode: "push",
    parallel: mcOpts.parallel !== false,
    poolSize: mcOpts.poolSize,
    spikeProfiles: true,
    spikeTriple: true,
    profiles: [],
    prioritySeeds: [],
    fillOrder: ["agility", "strength", "luck", "perception", "intellect", "divinity", "corruption"],
    randomSamples: mcOpts.randomSamples ?? 24,
    topK: mcOpts.topK ?? 10,
    finalists: mcOpts.finalists ?? 2,
  };
}

async function optimizePushStatsAsync(build, lookup, mcOpts = {}, onProgress) {
  const r = await coarseToFineOptimize(
    build,
    lookup,
    mcOpts,
    pushEvaluate,
    pushOptions(mcOpts),
    onProgress,
    pushFinalEvaluate,
  );

  return {
    stat_levels: r.stat_levels,
    expectedMaxStage: r.expectedScore,
    mc: r.mc,
    iterations: r.iterations,
    budget: r.budget,
    candidatesScreened: r.candidatesScreened,
  };
}

/** @deprecated Use optimizePushStatsAsync */
function optimizePushStats(build, lookup, mcOpts = {}, onProgress) {
  return optimizePushStatsAsync(build, lookup, mcOpts, onProgress);
}

return { optimizePushStatsAsync, pushEvaluate, pushFinalEvaluate, pushOptions, optimizePushStats };
})();
modules["xp-optimizer"] = (function() {
/**
 * Allocate stat points to maximize E[XP/hour] (MC).
 * Coarse candidate screen → hill-climb top seeds → confirm finalists.
 */

const { coarseToFineOptimize } = modules["stat-optimizer-core"];
const { runXpMonteCarlo } = modules["sim"];
const XP_PROFILES = [
  { strength: 5, agility: 3, perception: 0, intellect: 21, luck: 8 },
  { strength: 2, agility: 2, perception: 0, intellect: 28, luck: 8 },
  { strength: 0, agility: 4, perception: 0, intellect: 30, luck: 6 },
  { strength: 8, agility: 4, perception: 0, intellect: 24, luck: 4 },
  { strength: 0, agility: 8, perception: 0, intellect: 28, luck: 4 },
];

function xpEvaluate(build, lookup, mcOpts) {
  return runXpMonteCarlo(build, lookup, mcOpts).meanXpPerHour;
}

function xpFinalEvaluate(build, lookup, mcOpts) {
  const mc = runXpMonteCarlo(build, lookup, mcOpts);
  return { score: mc.meanXpPerHour, mc };
}

function xpOptions(mcOpts) {
  return {
    seed: mcOpts.seed ?? 54321,
    evaluateMode: "xp",
    parallel: mcOpts.parallel !== false,
    poolSize: mcOpts.poolSize,
    spikeProfiles: true,
    spikeTriple: true,
    profiles: XP_PROFILES,
    prioritySeeds: [],
    fillOrder: ["intellect", "luck", "strength", "perception", "agility", "divinity", "corruption"],
    randomSamples: mcOpts.randomSamples ?? 28,
    topK: mcOpts.topK ?? 12,
    finalists: mcOpts.finalists ?? 3,
  };
}

function optimizeXpStats(build, lookup, mcOpts = {}, onProgress) {
  return optimizeXpStatsAsync(build, lookup, mcOpts, onProgress);
}

async function optimizeXpStatsAsync(build, lookup, mcOpts = {}, onProgress) {
  const r = await coarseToFineOptimize(
    build,
    lookup,
    mcOpts,
    xpEvaluate,
    xpOptions(mcOpts),
    onProgress,
    xpFinalEvaluate,
  );

  return {
    stat_levels: r.stat_levels,
    expectedXpPerHour: r.expectedScore,
    mc: r.mc,
    iterations: r.iterations,
    budget: r.budget,
    candidatesScreened: r.candidatesScreened,
    coarseTrials: r.coarseTrials,
    refineTrials: r.refineTrials,
  };
}

return { optimizeXpStatsAsync, xpEvaluate, xpFinalEvaluate, xpOptions, optimizeXpStats, XP_PROFILES };
})();
modules["fragment-farm"] = (function() {
/**
 * Fragment farming bounds and display helpers.
 */

const CURRENCY_LABELS = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  mythic: "Mythic",
};

/** Fragment currencies tied to archaeology upgrade tiers. */
function fragmentCurrencies(lookup) {
  const tiers = lookup?.upgrades?.by_fragment_tier;
  if (!tiers || typeof tiers !== "object") return [];
  return Object.keys(tiers);
}

function fragmentCurrencyLabel(currency) {
  return CURRENCY_LABELS[currency] ?? currency;
}

/** Earliest stage where blocks of this currency can spawn and drop fragments. */
function minFarmStageForCurrency(lookup, currency) {
  let minStage = Infinity;

  for (const [family, def] of Object.entries(lookup?.blocks?.families || {})) {
    if (def.fragment_currency !== currency) continue;
    if (def.drops_fragments === false) continue;

    let tierMin = Infinity;
    for (const tier of def.tiers || []) {
      if (tier.fragments == null || tier.fragments <= 0) continue;
      tierMin = Math.min(tierMin, tier.first_stage ?? 1);
    }
    if (tierMin === Infinity) tierMin = 1;

    let spawnMin = Infinity;
    for (const band of lookup.spawn_probabilities?.stage_bands || []) {
      if ((band.percent?.[family] ?? 0) > 0) {
        spawnMin = Math.min(spawnMin, band.stage_min);
      }
    }
    for (const [stageStr, layout] of Object.entries(lookup.boss_stages?.stages || {})) {
      if (layout[family] > 0) {
        spawnMin = Math.min(spawnMin, parseInt(stageStr, 10));
      }
    }
    if (spawnMin === Infinity) spawnMin = tierMin;

    minStage = Math.min(minStage, Math.max(spawnMin, tierMin));
  }

  return minStage === Infinity ? 1 : minStage;
}

/** True when highest stage reached can reach stages that drop this currency. */
function isFragmentFarmable(highestStage, lookup, currency) {
  const hs = Math.max(1, Math.floor(highestStage ?? 1));
  return hs >= minFarmStageForCurrency(lookup, currency);
}

function formatFragPerHour(value, lookup) {
  const decimals = lookup?._meta?.fragment_display_decimals ?? 2;
  if (value >= 100) return value.toFixed(1);
  if (value >= 10) return value.toFixed(Math.min(2, decimals + 1));
  return value.toFixed(decimals + 1);
}

return { fragmentCurrencies, fragmentCurrencyLabel, minFarmStageForCurrency, isFragmentFarmable, formatFragPerHour, CURRENCY_LABELS };
})();
modules["fragment-optimizer"] = (function() {
/**
 * Allocate stat points to maximize E[fragments/hour] for a target currency (MC).
 */

const { coarseToFineOptimize } = modules["stat-optimizer-core"];
const { runFragmentMonteCarlo } = modules["sim"];
const FRAG_PROFILES = [
  { strength: 8, agility: 12, perception: 14, intellect: 0, luck: 3 },
  { strength: 5, agility: 10, perception: 18, intellect: 2, luck: 2 },
  { strength: 12, agility: 8, perception: 12, intellect: 0, luck: 5 },
  { strength: 3, agility: 14, perception: 16, intellect: 2, luck: 2 },
  { strength: 10, agility: 6, perception: 15, intellect: 4, luck: 2 },
];

function fragmentEvaluate(build, lookup, mcOpts) {
  return runFragmentMonteCarlo(build, lookup, mcOpts).meanFragPerHour;
}

function fragmentFinalEvaluate(build, lookup, mcOpts) {
  const mc = runFragmentMonteCarlo(build, lookup, mcOpts);
  return { score: mc.meanFragPerHour, mc };
}

function fragmentOptions(mcOpts) {
  return {
    seed: mcOpts.seed ?? 24680,
    evaluateMode: "fragment",
    parallel: mcOpts.parallel !== false,
    poolSize: mcOpts.poolSize,
    spikeProfiles: true,
    spikeTriple: true,
    profiles: FRAG_PROFILES,
    prioritySeeds: ["perception", "strength", "agility"],
    fillOrder: [
      "perception",
      "strength",
      "agility",
      "luck",
      "intellect",
      "divinity",
      "corruption",
    ],
    randomSamples: mcOpts.randomSamples ?? 28,
    topK: mcOpts.topK ?? 8,
    finalists: mcOpts.finalists ?? 3,
    refineConcurrency: mcOpts.refineConcurrency ?? 1,
    hillClimbMaxIter: mcOpts.hillClimbMaxIter ?? 120,
  };
}

function optimizeFragmentStats(build, lookup, mcOpts = {}, onProgress) {
  return optimizeFragmentStatsAsync(build, lookup, mcOpts, onProgress);
}

async function optimizeFragmentStatsAsync(
  build,
  lookup,
  mcOpts = {},
  onProgress,
) {
  const r = await coarseToFineOptimize(
    build,
    lookup,
    mcOpts,
    fragmentEvaluate,
    fragmentOptions(mcOpts),
    onProgress,
    fragmentFinalEvaluate,
  );

  return {
    stat_levels: r.stat_levels,
    expectedFragPerHour: r.expectedScore,
    mc: r.mc,
    iterations: r.iterations,
    budget: r.budget,
    candidatesScreened: r.candidatesScreened,
    coarseTrials: r.coarseTrials,
    refineTrials: r.refineTrials,
    targetCurrency: mcOpts.targetCurrency,
  };
}

return { optimizeFragmentStatsAsync, fragmentEvaluate, fragmentFinalEvaluate, fragmentOptions, optimizeFragmentStats, FRAG_PROFILES };
})();
modules["card-ui"] = (function() {
/**
 * Block card grid UI — one quality per (family, tier).
 */

const {
  CARD_FAMILIES,
  CARD_TIERS,
  CARD_QUALITIES,
  MISC_CARD_QUALITIES,
  activeBlockTiersAtStage,
  cardKey,
  normalizeBlockCards,
  normalizeMiscCardQuality,
} = modules["cards"];
const QUALITY_LABELS = {
  "": "—",
  normal: "Normal",
  gilded: "Gilded",
  polychrome: "Poly",
};

function store() {
  return window.ArchaeologyStore;
}

/** Registered for build-store syncToDom / syncFromDom / saveState. */
window.ArchaeologyCardSync = {
  fromDom: syncCardsFromDom,
  toDom: syncCardUiFromStore,
};

function emitChange() {
  store()?.saveState();
  document.dispatchEvent(new CustomEvent("archaeology-build-change"));
}

/** Read card dropdowns into store (so optimizers always see latest). */
function syncCardsFromDom() {
  const s = store();
  if (!s) return;
  ensureBlockCardsState();
  const cards = {};
  for (const family of CARD_FAMILIES) {
    for (const tier of CARD_TIERS) {
      const sel = document.getElementById(`card-${family}-${tier}`);
      if (!sel || !sel.value) continue;
      cards[cardKey(family, tier)] = sel.value;
    }
  }
  s.state.block_cards = cards;
  const misc = document.getElementById("misc-card-quality");
  if (misc) {
    s.state.misc_card_quality = normalizeMiscCardQuality(misc.value) || "";
  }
}

function fillAllCardQuality(quality) {
  ensureBlockCardsState();
  for (const family of CARD_FAMILIES) {
    for (const tier of CARD_TIERS) {
      const sel = document.getElementById(`card-${family}-${tier}`);
      if (!sel) continue;
      sel.value = quality;
      if (quality) store().state.block_cards[cardKey(family, tier)] = quality;
      else delete store().state.block_cards[cardKey(family, tier)];
    }
  }
  emitChange();
}

function refreshCardTierHint(lookup) {
  const el = document.getElementById("card-tier-hint");
  if (!el || !lookup) return;
  const hs =
    parseInt(document.getElementById("highest-stage")?.value, 10) ||
    store()?.state.highest_stage ||
    1;
  const tiers = activeBlockTiersAtStage(hs, lookup);
  const parts = CARD_FAMILIES.map(
    (f) => `${f.slice(0, 4)} T${tiers[f]}`,
  ).join(", ");
  el.textContent = `At highest stage ${hs}, spawned tiers are: ${parts}, divine T${tiers.divine ?? 1} (boss only). Card buffs (−HP, +XP) apply only to the matching tier column. Dirt has cards but no fragment drops.`;
}

function ensureBlockCardsState() {
  const s = store();
  if (!s) return;
  if (!s.state.block_cards || typeof s.state.block_cards !== "object") {
    s.state.block_cards = {};
  }
}

function syncCardUiFromStore() {
  ensureBlockCardsState();
  const cards = normalizeBlockCards(store()?.state.block_cards);
  for (const family of CARD_FAMILIES) {
    for (const tier of CARD_TIERS) {
      const sel = document.getElementById(`card-${family}-${tier}`);
      if (!sel) continue;
      const q = cards[cardKey(family, tier)] || "";
      sel.value = q;
    }
  }
  const misc = document.getElementById("misc-card-quality");
  if (misc) {
    misc.value = store()?.state.misc_card_quality || "";
  }
}

function initCardUI() {
  const grid = document.getElementById("block-cards-grid");
  if (!grid || grid.dataset.built === "1") {
    syncCardUiFromStore();
    return;
  }
  grid.dataset.built = "1";

  const fillRow = document.createElement("div");
  fillRow.className = "cards-fill-row";
  fillRow.innerHTML = `
    <span class="cards-fill-label">Fill all tiers:</span>
    <button type="button" class="btn btn-step" data-fill="">Clear</button>
    <button type="button" class="btn btn-step" data-fill="normal">Normal</button>
    <button type="button" class="btn btn-step" data-fill="gilded">Gilded</button>
    <button type="button" class="btn btn-step" data-fill="polychrome">Poly</button>
  `;
  fillRow.querySelectorAll("[data-fill]").forEach((btn) => {
    btn.addEventListener("click", () => fillAllCardQuality(btn.dataset.fill || ""));
  });
  grid.appendChild(fillRow);

  const table = document.createElement("table");
  table.className = "cards-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML = "<th>Block</th>" + CARD_TIERS.map((t) => `<th>T${t}</th>`).join("");
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const family of CARD_FAMILIES) {
    const tr = document.createElement("tr");
    const name = document.createElement("th");
    name.textContent = family.charAt(0).toUpperCase() + family.slice(1);
    tr.appendChild(name);

    for (const tier of CARD_TIERS) {
      const td = document.createElement("td");
      const sel = document.createElement("select");
      sel.id = `card-${family}-${tier}`;
      sel.className = "card-select";
      sel.title = `${family} tier ${tier} — highest owned quality only`;

      const opts = ["", ...CARD_QUALITIES];
      for (const q of opts) {
        const o = document.createElement("option");
        o.value = q;
        o.textContent = QUALITY_LABELS[q] ?? q;
        sel.appendChild(o);
      }

      sel.addEventListener("change", () => {
        ensureBlockCardsState();
        const key = cardKey(family, tier);
        const val = sel.value;
        if (!val) delete store().state.block_cards[key];
        else store().state.block_cards[key] = val;
        emitChange();
      });

      td.appendChild(sel);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  grid.appendChild(table);

  const miscWrap = document.getElementById("misc-card-wrap");
  if (miscWrap && !miscWrap.querySelector("#misc-card-quality")) {
    const label = document.createElement("label");
    label.className = "misc-card-label";
    label.innerHTML =
      'Archaeology misc card <select id="misc-card-quality" class="card-select"></select>';
    const sel = label.querySelector("select");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "—";
    sel.appendChild(none);
    for (const q of MISC_CARD_QUALITIES) {
      const o = document.createElement("option");
      o.value = q;
      o.textContent = QUALITY_LABELS[q] ?? q;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      if (store()) {
        store().state.misc_card_quality = normalizeMiscCardQuality(sel.value) || "";
        emitChange();
      }
    });
    miscWrap.appendChild(label);
  }

  syncCardUiFromStore();
  document.addEventListener("archaeology-build-change", () => {
    syncCardUiFromStore();
    refreshCardTierHint(window.__archaeologyLookup);
  });
}

return { store, emitChange, syncCardsFromDom, fillAllCardQuality, refreshCardTierHint, ensureBlockCardsState, syncCardUiFromStore, initCardUI, QUALITY_LABELS };
})();
modules["lookup-index"] = (function() {

function indexLookup(lookup) {
  const upgradeById = {};
  for (const [tier, list] of Object.entries(lookup.upgrades.by_fragment_tier)) {
    for (const u of list) {
      upgradeById[u.id] = { ...u, fragment_tier: tier };
    }
  }
  for (const u of lookup.gem_upgrades.upgrades) {
    upgradeById[u.id] = { ...u, fragment_tier: "gem" };
  }
  lookup._upgradeById = upgradeById;
  return lookup;
}
let embeddedCache = null;
const LOOKUP_JSON = {
  "_meta": {
    "description": "Archaeology gamemode reference data for calculators. Blocks and rocks are the same thing.",
    "fragment_display_decimals": 2
  },

  "stat_points": {
    "_note": "1 point per archaeology level. Free respec anytime.",
    "stats": {
      "strength": {
        "unlock": { "ascension": 0 },
        "level_cap_base": 50,
        "per_point": {
          "flat_damage": 1,
          "damage_percent": 0.01,
          "crit_damage_percent": 0.03
        }
      },
      "agility": {
        "unlock": { "ascension": 0 },
        "level_cap_base": 50,
        "per_point": {
          "max_stamina": 5,
          "crit_chance": 0.01,
          "speed_mod_proc_chance": 0.002
        }
      },
      "perception": {
        "unlock": { "ascension": 0 },
        "level_cap_base": 25,
        "per_point": {
          "fragment_gain_percent": 0.04,
          "loot_mod_proc_chance": 0.003,
          "flat_armor_penetration": 2
        }
      },
      "intellect": {
        "unlock": { "ascension": 0 },
        "level_cap_base": 25,
        "per_point": {
          "experience_gain_percent": 0.05,
          "experience_mod_proc_chance": 0.003,
          "armor_penetration_percent": 0.03
        }
      },
      "luck": {
        "unlock": { "ascension": 0 },
        "level_cap_base": 25,
        "per_point": {
          "crit_chance": 0.02,
          "all_mod_proc_chance_bonus": 0.002,
          "golden_crosshair_chance": 0.005
        }
      },
      "divinity": {
        "unlock": { "ascension": 1 },
        "level_cap_base": 10,
        "per_point": {
          "flat_damage": 2,
          "super_crit_chance": 0.02,
          "crosshair_auto_tap_chance": 0.02
        }
      },
      "corruption": {
        "unlock": { "ascension": 2 },
        "level_cap_base": 10,
        "per_point": {
          "damage_percent": 0.06,
          "max_stamina_percent": -0.03,
          "all_mod_multiplier_bonus_percent": 0.01
        }
      }
    }
  },

  "combat_timing": {
    "_note": "Simulators should advance elapsed time per hit, not fractional hit counts during speed buffs. Mod magnitudes are upgrade-deterministic; only mod presence/spawn may be stochastic via proc_chance stats.",
    "simulator_approach": "index_elapsed_seconds",
    "stamina_per_hit": 1,
    "attack_speed_multipliers": {
      "baseline": 1,
      "speed_mod_active": 2,
      "flurry_active": 2,
      "speed_mod_and_flurry_together": 4
    },
    "seconds_per_hit": {
      "formula": "1 / attack_speed_multiplier",
      "by_multiplier": {
        "1": 1,
        "2": 0.5,
        "4": 0.25
      }
    },
    "ability_cooldowns": {
      "_note": "Cooldown reductions on upgrades/skills are expressed in attacks at baseline speed; when simulating with time index, convert using current seconds_per_hit if cooldown ticks in real time, or count discrete hits if cooldown is hit-based — confirm per skill when wiring sim."
    }
  },

  "combat": {
    "hits_to_break": {
      "formula": "ceil(block_hp / damage_per_hit_after_armor)",
      "stamina_per_break": "hits_to_break (1 stamina per hit)"
    },
    "armor": {
      "type": "flat",
      "damage_per_hit": "max(0, raw_damage - effective_armor)",
      "example": { "raw_damage": 10, "block_armor": 4, "damage_dealt": 6 }
    },
    "armor_penetration": {
      "flat": "reduces block armor before subtraction (order with % pen TBD)",
      "percent": {
        "rounding": "TBD (truncate vs nearest vs ceil — matters near damage thresholds)",
        "implementation_priority": "low until % pen is on the build"
      }
    },
    "base_damage": 10,
    "base_max_stamina": 100,
    "base_crit_damage_multiplier": 1.5,
    "base_ultra_crit_damage_multiplier": 3,
    "crit_damage_multiplier": "base_crit_damage_multiplier × (1 + sum of displayed crit_damage_percent bonuses). Each +3% STR / +1% upgrade is % of the 1.5× base (shows as +4.5% / +1.5% on the mult). UI truncates displayed × to 2 decimals.",
    "ultra_crit_damage_multiplier": "base_ultra_crit_damage_multiplier + ultra_crit_damage_percent from upgrades",
    "damage_stat_in_ui": "round(flat × damage_multiplier) — pre-armor, no crit averaging",
    "average_hit_damage": "raw × (1 − crit_chance + crit_chance × crit_damage_multiplier)",
    "raw_damage": {
      "_note": "flat × damage_mult; sim uses average_hit_damage vs armor"
    }
  },

  "optimizer_objectives": {
    "fragment_farm": {
      "deterministic_floor_budget": "fast baseline for E[fragments/hour] at a fixed stage band",
      "known_bias": "Treats falling short of target depth and overshooting optimal depth similarly; understates risk of ending before the fragment type spawns.",
      "asymmetric_depth": {
        "below_family_first_stage": "zero fragments of that currency for that run segment",
        "above_optimal_band": "lower spawn rate or tier efficiency but still farmable",
        "priority": "reaching unlock stage for target family matters more than avoiding overshoot"
      },
      "recommended_metrics": [
        "P(max_stage >= family_tier_first_stage) for target fragment",
        "E[fragments | run reaches farm band] × P(reach band)",
        "MC or constrained search on stage band, not E[max_stage] alone"
      ],
      "first_stage_source": "blocks.families.<family>.tiers[].first_stage"
    },
    "push": {
      "primary": "E[max_stage] or P(max_stage >= target)",
      "tooling": "MC run sim; deterministic floor budget is a weak lower/upper bound only"
    }
  },

  "active_skills": {
    "_note": "Calculator assumes auto use unless extended later.",
    "skills": {
      "enrage": {
        "charges": 5,
        "cooldown_seconds": 60,
        "per_attack_while_active": {
          "charges_consumed": 1,
          "damage_percent": 0.2,
          "crit_damage_percent": 1.0,
          "guarantees_crit": false
        }
      },
      "flurry": {
        "charges": 5,
        "cooldown_seconds": 120,
        "on_cast": {
          "attack_speed_multiplier": 2,
          "attack_speed_percent": 1.0,
          "stamina_added": 5
        },
        "_note": "With speed mod active, combined attack speed is 4× (not 2×+2× additive). See combat_timing.attack_speed_multipliers."
      },
      "quake": {
        "charges": 5,
        "cooldown_seconds": 180,
        "per_attack_while_active": {
          "charges_consumed": 1,
          "cleave_damage_percent_of_hit": 0.2,
          "targets": "all_blocks"
        }
      }
    }
  },

  "external_unlocks": {
    "_note": "Features unlocked outside the archaeology gamemode. Fragment gain bonuses from this section stack multiplicatively with each other and in-game sources.",
    "fragment_gain_stacking": {
      "_note": "Each source below sums its own bonus additively, then all sources multiply together.",
      "between_sources": "multiplicative",
      "within_source": "additive_percent"
    },
    "block_bonker": {
      "player_state_flag": "has_block_bonker",
      "effects_when_owned": {
        "damage_percent_per_highest_stage": 0.01,
        "max_stamina_percent_per_highest_stage": 0.01,
        "speed_mod_gain_bonus": 15,
        "speed_mod_duration_extra_hits": 15
      },
      "_speed_mod_clarification": "Base speed mod +10 hits at 2× attack speed; total hits from upgrades (see block_modifiers). Bonker +15 hits and +15 duration."
    },
    "fragment_bundle_iap": {
      "player_state_flag": "has_fragment_bundle",
      "source": "real_money_bundle",
      "max_purchases": 1,
      "fragment_gain_multiplier": 1.25
    },
    "cave_legendary_fish_tribute": {
      "player_state_flag": "has_cave_legendary_fish_level_1_tribute",
      "source": "Cave Legendary Fish (Level 1 Tribute)",
      "fragment_gain_percent_per_mythic_chest": 0.0025,
      "player_state_count": "mythic_chests_owned",
      "within_source_stacking": "additive",
      "formula": "1 + 0.0025 * mythic_chests_owned",
      "example": "4 chests → +1% from this source → ×1.01 on total fragment gain"
    },
    "axolotl_skin_quest": {
      "player_state_flag": "axolotl_skin_quest_rank",
      "source": "Axolotl skin quest",
      "fragment_gain_percent_per_rank": 0.03,
      "rank_starts_at": 0,
      "rank_0_has_bonus": true,
      "within_source_stacking": "additive",
      "formula": "1 + 0.03 * (rank + 1)",
      "example": "rank 0 → +3% (×1.03); rank 2 → +9% from this source (×1.09)"
    }
  },

  "cards": {
    "_note": "Per block family (dirt–divine). Dirt has cards and the same quality HP/XP buffs but blocks do not drop fragments. Future: card-farm optimizer may differ from fragment farmer. Infernal buffs per block/tier are placeholder until mechanics are known.",
    "families_with_cards": ["dirt", "common", "rare", "epic", "legendary", "mythic", "divine"],
    "card_identity": "one card line per (block_family, block_tier 1–4)",
    "on_block_destroy": {
      "drop_card_chance_by_block_tier": {
        "1": { "numerator": 1, "denominator": 1500 },
        "2": { "numerator": 1, "denominator": 1500 },
        "3": { "numerator": 1, "denominator": 1500 },
        "4": { "numerator": 1, "denominator": 15000 }
      }
    },
    "progression": {
      "order": ["normal", "gilded", "polychrome", "infernal"],
      "gild": { "requires": "normal_card" },
      "polychrome_roll": {
        "requires": "gilded_card",
        "chance_by_block_tier": {
          "1": { "numerator": 1, "denominator": 7500 },
          "2": { "numerator": 1, "denominator": 7500 },
          "3": { "numerator": 1, "denominator": 7500 },
          "4": { "numerator": 1, "denominator": 75000 }
        }
      },
      "infernal_shard_roll": {
        "requires": "polychrome_card_completed_for_that_tier",
        "requires_hades_idol": true,
        "requires_poly_ignited": true,
        "chance": { "numerator": 1, "denominator": 200000 },
        "shards_per_success": 0.1,
        "shards_for_full_infernal": 10,
        "buffs": { "status": "placeholder", "_note": "unique per (block_family, block_tier); not encoded yet" }
      }
    },
    "qualities": {
      "normal": {
        "block_hp_multiplier": 0.9,
        "exp_and_loot_multiplier": 1.1,
        "_note": "-10% HP, +10% exp/loot for matching block tier. Duplicate cards increase bonus — stacking rules TBD."
      },
      "gilded": {
        "block_hp_multiplier": 0.8,
        "exp_and_loot_multiplier": 1.2
      },
      "polychrome": {
        "block_hp_multiplier": 0.65,
        "exp_and_loot_multiplier": 1.35,
        "max_with_polychrome_archaeology_card_upgrade": {
          "block_hp_multiplier": 0.5,
          "exp_and_loot_multiplier": 1.5,
          "from_upgrade": "polychrome_archaeology_card_bonus",
          "upgrade_adds_to_both_stats": 0.15
        }
      }
    },
    "archaeology_misc_card": {
      "_note": "Separate from block-tier cards.",
      "ability_cooldown_reduction": {
        "normal": 0.03,
        "gilded": 0.06,
        "polychrome": 0.1
      }
    },
    "future_optimizer": "card_farm_may_differ_from_fragment_farm_for_non_dirt_blocks"
  },

  "idols": {
    "_note": "Idols use fragment currencies per tier except divine (divine_idols tokens). Most idols are out of archaeology scope except those listed in optimize_for_archaeology.",
    "divine_idol_rolls": {
      "currency": "divine_idols",
      "cost_per_roll": 1,
      "cost_increases": false,
      "tier_probabilities": {
        "common": 0.29,
        "rare": 0.23,
        "epic": 0.18,
        "legendary": 0.14,
        "mythic": 0.09,
        "divine": 0.07
      },
      "_note": "Divine token does not guarantee a divine-tier idol; rolls random tier in pool."
    },
    "optimize_for_archaeology": ["hestia", "hades"],
    "hestia": {
      "id": "hestia",
      "fragment_currency": "common",
      "fragment_tier_label": "common",
      "archaeology_effect": {
        "fragment_gain_percent_per_stack": 0.0001,
        "fragment_gain_cap_stacks": 3000,
        "fragment_gain_cap_percent": 0.3
      },
      "enabled_when": { "ascension_min": 1 },
      "unlock_roll_conditions": {
        "min_rolls_in_tier_before_eligible": 20,
        "tier_for_roll_gate": "common",
        "_roll_pool_note": "Each idol unlock rolls randomly from eligible idols in pool. Equal weight unconfirmed; may depend on Obelisks (external) — placeholder."
      },
      "roll_mechanics": {
        "status": "placeholder",
        "assumed_equal_weight": null,
        "obelisk_dependency": null
      }
    },
    "hades": {
      "id": "hades",
      "fragment_currency": "divine_idols",
      "idol_tier_label": "divine",
      "enabled_when": { "archaeology_level_min": 85 },
      "external_unlock": {
        "fishing": "Blackened Basker Tribute 2"
      },
      "archaeology_effect": {
        "unlocks_infernal_card_path": true,
        "requires_polychrome_ignited_per_tier": true
      },
      "infernal_cards": {
        "status": "placeholder",
        "_note": "Per (block_family, block_tier) unique buff; shard roll 1/200000 for 0.1 shard after poly ignited. Full mechanics TBD."
      },
      "roll_mechanics": {
        "status": "placeholder",
        "pool": "divine_idol_rolls",
        "obtaining_hades": "random divine-tier idol roll; not guaranteed"
      }
    }
  },

  "ascension": {
    "_note": "Ascending resets progress. Believed to multiply upgrade costs by 5x per ascension (confirm when encoding upgrades).",
    "upgrade_cost_multiplier_per_ascension": 5,
    "tiers": {
      "0": {
        "label": "pre-ascension",
        "unlocks_stats": ["strength", "agility", "perception", "intellect", "luck"]
      },
      "1": {
        "requirements": {
          "archaeology_level": 90,
          "highest_stage": 115
        },
        "unlocks_stats": ["divinity"]
      },
      "2": {
        "requirements": {
          "archaeology_level": 100,
          "highest_stage": 150
        },
        "unlocks_stats": ["corruption"]
      }
    }
  },

  "spawn_probabilities": {
    "_note": "Per grid slot on non-boss stages. Percentages are per-slot spawn chance for that family; residual = empty slot (no block). Divine is not in random pool — boss/special only.",
    "family_order": ["dirt", "common", "rare", "epic", "legendary", "mythic"],
    "stage_bands": [
      { "stage_min": 1, "stage_max": 2, "percent": { "dirt": 28.57, "common": 14.29 } },
      { "stage_min": 3, "stage_max": 4, "percent": { "dirt": 25.4, "common": 12.7, "rare": 11.11 } },
      { "stage_min": 5, "stage_max": 5, "percent": { "dirt": 25.52, "common": 10.94, "rare": 12.5 } },
      { "stage_min": 6, "stage_max": 9, "percent": { "dirt": 22.97, "common": 9.84, "rare": 11.25, "epic": 10 } },
      { "stage_min": 10, "stage_max": 11, "percent": { "dirt": 23.41, "common": 8.78, "rare": 9.88, "epic": 11.11 } },
      { "stage_min": 12, "stage_max": 14, "percent": { "dirt": 21.74, "common": 8.15, "rare": 9.17, "epic": 10.32, "legendary": 7.14 } },
      { "stage_min": 15, "stage_max": 19, "percent": { "dirt": 21.27, "common": 7.98, "rare": 8.97, "epic": 11.54, "legendary": 7.69 } },
      { "stage_min": 20, "stage_max": 24, "percent": { "dirt": 19.5, "common": 7.31, "rare": 8.23, "epic": 12.34, "legendary": 8.64, "mythic": 5 } },
      { "stage_min": 25, "stage_max": 29, "percent": { "dirt": 18.47, "common": 7.92, "rare": 9.05, "epic": 12.06, "legendary": 10.56, "mythic": 5 } },
      { "stage_min": 30, "stage_max": 49, "percent": { "dirt": 18.1, "common": 9.05, "rare": 7.92, "epic": 11.88, "legendary": 11.88, "mythic": 5 } },
      { "stage_min": 50, "stage_max": 74, "percent": { "dirt": 16.87, "common": 8.43, "rare": 9.84, "epic": 13.77, "legendary": 11.81, "mythic": 5.56 } },
      { "stage_min": 75, "stage_max": null, "percent": { "dirt": 16.81, "common": 10.08, "rare": 10.08, "epic": 11.76, "legendary": 11.76, "mythic": 5.88 } }
    ],
    "empty_slot_percent": {
      "_note": "100 minus sum of family percents in band",
      "1-2": 57.14,
      "3-4": 50.79,
      "5": 51.04,
      "6-9": 45.94,
      "10-11": 46.82,
      "12-14": 43.48,
      "15-19": 42.55,
      "20-24": 38.98,
      "25-29": 36.94,
      "30-49": 36.17,
      "50-74": 33.72,
      "75+": 33.63
    }
  },

  "boss_stages": {
    "_note": "Fixed 24-tile layouts (6×4). Overrides random per-slot spawns. Block tier uses tier_resolution rule at that stage.",
    "grid_slots": 24,
    "stages": {
      "11": { "dirt": 24 },
      "17": { "common": 24 },
      "23": { "dirt": 24 },
      "25": { "rare": 24 },
      "29": { "epic": 24 },
      "31": { "legendary": 24 },
      "34": { "common": 20, "legendary": 4 },
      "35": { "rare": 24 },
      "41": { "epic": 24 },
      "44": { "legendary": 24 },
      "49": { "dirt": 6, "common": 6, "rare": 6, "mythic": 6 },
      "74": { "common": 22, "divine": 2 },
      "95": { "common": 24 },
      "98": { "mythic": 24 },
      "99": { "dirt": 4, "common": 4, "rare": 4, "epic": 4, "legendary": 4, "mythic": 4 },
      "110": { "rare": 24 },
      "125": { "epic": 24 },
      "135": { "legendary": 24 },
      "140": { "mythic": 24 },
      "149": { "divine": 24 }
    }
  },

  "blocks": {
    "_note": "7 families × 4 tiers. HP: base_hp × 3^(tier-1). EXP: exp_base × 3^(tier-1). Armor (non-dirt): base × 1.65^(tier-1). Dirt = XP only, no fragments. First fragment currency is common.",
    "tier_resolution": {
      "_note": "On normal and boss spawns, a family's tier is always the highest tier unlocked at current stage (not a mix of lower tiers).",
      "rule": "tier = max { t : tiers[t].first_stage <= current_stage }"
    },
    "rewards": {
      "exp_formula": "exp_base * 3^(tier - 1)",
      "exp_base_by_family": {
        "dirt": 0.05,
        "common": 0.15,
        "rare": 0.35,
        "epic": 1,
        "legendary": 3.5,
        "mythic": 7.5,
        "divine": 20
      },
      "fragments_per_tier": [0.01, 0.02, 0.04, 0.08],
      "fragments_formula": "fragments_per_tier[tier - 1] in matching currency (none for dirt)"
    },
    "tier_hp_multiplier_within_family": 3,
    "tier_exp_multiplier_within_family": 3,
    "armor_growth_per_tier": 1.65,
    "families": {
      "dirt": {
        "fragment_currency": null,
        "drops_fragments": false,
        "exp_base_tier1": 0.05,
        "hp_base_tier1": 100,
        "armor": { "all_tiers": 0 },
        "tiers": [
          { "tier": 1, "first_stage": 1, "hp": 100, "armor": 0, "exp": 0.05, "fragments": null },
          { "tier": 2, "first_stage": 12, "hp": 300, "armor": 0, "exp": 0.15, "fragments": null },
          { "tier": 3, "first_stage": 24, "hp": 900, "armor": 0, "exp": 0.45, "fragments": null },
          { "tier": 4, "first_stage": 81, "hp": 2700, "armor": 0, "exp": 1.35, "fragments": null }
        ]
      },
      "common": {
        "fragment_currency": "common",
        "exp_base_tier1": 0.15,
        "hp_base_tier1": 250,
        "armor_base_tier1": 5,
        "tiers": [
          { "tier": 1, "first_stage": 1, "hp": 250, "armor": 5, "exp": 0.15, "fragments": 0.01 },
          { "tier": 2, "first_stage": 18, "hp": 750, "armor": 8.25, "exp": 0.45, "fragments": 0.02 },
          { "tier": 3, "first_stage": 30, "hp": 2250, "armor": 13.61, "exp": 1.35, "fragments": 0.04 },
          { "tier": 4, "first_stage": 96, "hp": 6750, "armor": 22.46, "exp": 4.05, "fragments": 0.08 }
        ]
      },
      "rare": {
        "fragment_currency": "rare",
        "exp_base_tier1": 0.35,
        "hp_base_tier1": 550,
        "armor_base_tier1": 12,
        "tiers": [
          { "tier": 1, "first_stage": 3, "hp": 550, "armor": 12, "exp": 0.35, "fragments": 0.01 },
          { "tier": 2, "first_stage": 26, "hp": 1650, "armor": 19.8, "exp": 1.05, "fragments": 0.02 },
          { "tier": 3, "first_stage": 36, "hp": 4950, "armor": 32.67, "exp": 3.15, "fragments": 0.04 },
          { "tier": 4, "first_stage": 111, "hp": 14850, "armor": 53.91, "exp": 9.45, "fragments": 0.08 }
        ]
      },
      "epic": {
        "fragment_currency": "epic",
        "exp_base_tier1": 1,
        "hp_base_tier1": 1150,
        "armor_base_tier1": 25,
        "tiers": [
          { "tier": 1, "first_stage": 6, "hp": 1150, "armor": 25, "exp": 1, "fragments": 0.01 },
          { "tier": 2, "first_stage": 30, "hp": 3450, "armor": 41.25, "exp": 3, "fragments": 0.02 },
          { "tier": 3, "first_stage": 42, "hp": 10350, "armor": 68.06, "exp": 9, "fragments": 0.04 },
          { "tier": 4, "first_stage": 126, "hp": 31050, "armor": 112.3, "exp": 27, "fragments": 0.08 }
        ]
      },
      "legendary": {
        "fragment_currency": "legendary",
        "exp_base_tier1": 3.5,
        "hp_base_tier1": 1950,
        "armor_base_tier1": 50,
        "tiers": [
          { "tier": 1, "first_stage": 12, "hp": 1950, "armor": 50, "exp": 3.5, "fragments": 0.01 },
          { "tier": 2, "first_stage": 32, "hp": 5850, "armor": 82.5, "exp": 10.5, "fragments": 0.02 },
          { "tier": 3, "first_stage": 45, "hp": 17550, "armor": 136.12, "exp": 31.5, "fragments": 0.04 },
          { "tier": 4, "first_stage": 136, "hp": 52650, "armor": 224.61, "exp": 94.5, "fragments": 0.08 }
        ]
      },
      "mythic": {
        "fragment_currency": "mythic",
        "exp_base_tier1": 7.5,
        "hp_base_tier1": 3500,
        "armor_base_tier1": 150,
        "tiers": [
          { "tier": 1, "first_stage": 20, "hp": 3500, "armor": 150, "exp": 7.5, "fragments": 0.01 },
          { "tier": 2, "first_stage": 35, "hp": 10500, "armor": 247.5, "exp": 22.5, "fragments": 0.02 },
          { "tier": 3, "first_stage": 50, "hp": 31500, "armor": 408.37, "exp": 67.5, "fragments": 0.04 },
          { "tier": 4, "first_stage": 141, "hp": 94500, "armor": 673.82, "exp": 202.5, "fragments": 0.08 }
        ]
      },
      "divine": {
        "fragment_currency": "divine_idols",
        "exp_base_tier1": 20,
        "hp_base_tier1": 25000,
        "armor_base_tier1": 300,
        "tiers": [
          { "tier": 1, "first_stage": 50, "hp": 25000, "armor": 300, "exp": 20, "fragments": 0.01 },
          { "tier": 2, "first_stage": 75, "hp": 75000, "armor": 495, "exp": 60, "fragments": 0.02 },
          { "tier": 3, "first_stage": 100, "hp": 225000, "armor": 816.75, "exp": 180, "fragments": 0.04 },
          { "tier": 4, "first_stage": 150, "hp": 675000, "armor": 1347.64, "exp": 540, "fragments": 0.08 }
        ]
      }
    },
    "stage_scaling": {
      "_note": "Every 50 stages from 100 inclusive. Multipliers stack multiplicatively at each milestone reached. Confirm if per-milestone-global vs per-family — encoded as global per milestone index.",
      "interval": 50,
      "first_stage": 100,
      "milestone_stages": [100, 150, 200, 250, 300, 350, 400, 450, 500],
      "hp_multiplier_per_milestone": [2, 2, 2, 2, 4, 2, 2, 2, 2],
      "armor_multiplier_per_milestone": [1.5, 1, 1.5, 1.5, 2.25, 1.5, 1.5, 1.5, 1.5],
      "cumulative_formula": "stat_at_stage = base_stat * product(multiplier[i] for i where milestone_stages[i] <= stage)"
    }
  },

  "block_modifiers": {
    "_note": "A block may have multiple modifiers but at most one of each type. Mod strength is NOT rolled. Value = base + contribution from archaeology upgrades (caps in upgrades.by_fragment_tier); simulator derives current and max from upgrade levels, not hardcoded ceilings.",
    "value_scaling": "deterministic_from_upgrades",
    "max_one_per_type_per_block": true,
    "types": {
      "experience": {
        "alias": ["exp_mod", "experience_mod"],
        "effect": "experience_from_block_multiplier",
        "base": 3,
        "upgrade_keys": ["exp_mod_gain_and_chance"]
      },
      "loot": {
        "alias": ["loot_mod"],
        "effect": "fragments_from_block_multiplier",
        "base": 2,
        "upgrade_keys": ["loot_mod_multiplier"]
      },
      "speed": {
        "alias": ["speed_mod"],
        "effect": "attack_speed_multiplier_while_active",
        "attack_speed_multiplier": 2,
        "base_bonus_hits": 10,
        "upgrade_keys": ["max_stamina_stamina_mod_gain", "stamina_mod_gain_epic"],
        "_note": "Fixed hit count from upgrades (+ Block Bonker +15 when owned). Each speed-mod block adds that many hits on first hit (stacks if speed already active; does not reset). With Flurry active, 4× attack speed; else 2×."
      },
      "stamina": {
        "alias": ["stamina_mod"],
        "effect": "stamina_restored_when_mod_triggers",
        "base": 3,
        "upgrade_keys": ["max_stamina_stamina_mod_gain", "stamina_mod_gain_epic"],
        "cannot_exceed_max_stamina": true
      }
    },
    "spawn_proc_stats": {
      "_note": "Stat/upgrade '*_mod_proc_chance' controls whether a block spawns with (or gains) that mod type — separate from mod magnitude. Magnitude is never rolled.",
      "speed_mod": "agility.speed_mod_proc_chance per point",
      "loot_mod": "perception.loot_mod_proc_chance per point",
      "experience_mod": "intellect.experience_mod_proc_chance per point",
      "all_mod_types": "luck.all_mod_proc_chance_bonus per point",
      "all_mod_magnitude": "corruption.all_mod_multiplier_bonus_percent per point"
    }
  },

  "crosshairs": {
    "red": {
      "_note": "Normal crosses; manual tap for bonus damage on that block."
    },
    "golden": {
      "source": "luck.golden_crosshair_chance",
      "stronger_than_red": true,
      "optimization_priority": "low_idle_assumption",
      "future": "skill may auto-tap golden crosses"
    },
    "divinity_auto_tap": {
      "source": "divinity.crosshair_auto_tap_chance",
      "targets": "crosshairs"
    }
  },

  "upgrades": {
    "_note": "Bought with fragment currencies by tier (common / rare / epic / legendary / mythic). Unless flat_cost is set, each purchase uses geometric growth below. unlock_stage = highest stage reached when the upgrade row becomes purchasable (order matches by_fragment_tier lists).",
    "default_growth_per_level": 1.2,
    "cost_at_level": {
      "raw": "base_cost * 1.2^(level - 1)",
      "rule": "If raw >= 100: int(raw) (0 decimal places). Else: round(raw, 2).",
      "example": "strength_stat_buff level 4: raw=172.8 → cost=172"
    },
    "by_fragment_tier": {
      "common": [
        {
          "id": "flat_damage",
          "unlock_stage": 1,
          "per_level": { "flat_damage": 1 },
          "cap": 25,
          "base_cost": 0.5,
          "verified_costs": [0.5, 0.6, 0.72, 0.86, 1.04, 1.24, 1.49, 1.79, 2.15, 2.58, 3.1]
        },
        {
          "id": "flat_armor_penetration",
          "unlock_stage": 2,
          "per_level": { "flat_armor_penetration": 1 },
          "cap": 25,
          "base_cost": 0.75,
          "verified_costs": [0.75, 0.9, 1.08, 1.3]
        },
        {
          "id": "archaeology_exp_gain",
          "unlock_stage": 3,
          "per_level": { "archaeology_exp_gain_percent": 0.02 },
          "cap": 25,
          "base_cost": 1,
          "verified_costs": [1, 1.2, 1.44, 1.73]
        },
        {
          "id": "crit_chance_and_crit_damage",
          "unlock_stage": 4,
          "per_level": {
            "crit_chance": 0.0025,
            "crit_damage_percent": 0.01
          },
          "_crit_damage_note": "UI says +1% crit damage per level; stacks as +1% of 1.5× base (+0.015 to multiplier per level).",
          "cap": 25,
          "base_cost": 2,
          "verified_costs": [2, 2.4, 2.88]
        },
        {
          "id": "strength_stat_buff",
          "unlock_stage": 13,
          "per_level": {
            "strength_flat_damage_bonus": 0.2,
            "strength_damage_percent_bonus": 0.001
          },
          "cap": 5,
          "base_cost": 100,
          "verified_costs": [100, 120, 144, 172]
        },
        {
          "id": "polychrome_archaeology_card_bonus",
          "unlock_stage": 34,
          "per_level": { "polychrome_card_bonus_add_percent": 0.15 },
          "cap": 1,
          "flat_cost": 10000,
          "_effect": "Raises polychrome card bonuses from 35% to 50% on HP reduction and exp/loot for matching block cards (rare fragment tier upgrade)."
        }
      ],
      "rare": [
        {
          "id": "max_stamina_and_stamina_mod_chance",
          "unlock_stage": 5,
          "per_level": {
            "max_stamina": 2,
            "stamina_mod_proc_chance": 0.0005
          },
          "cap": 20,
          "base_cost": 2.4
        },
        {
          "id": "flat_damage_rare",
          "unlock_stage": 6,
          "per_level": { "flat_damage": 2 },
          "cap": 20,
          "base_cost": 3
        },
        {
          "id": "loot_mod_multiplier",
          "unlock_stage": 6,
          "per_level": { "loot_mod_multiplier_gain": 0.3 },
          "cap": 10,
          "base_cost": 4.5
        },
        {
          "id": "enrage_buff",
          "unlock_stage": 7,
          "per_level": {
            "enrage_damage_percent": 0.02,
            "enrage_crit_damage_percent": 0.02,
            "enrage_cooldown_attacks": -1
          },
          "cap": 15,
          "base_cost": 6
        },
        {
          "id": "agility_stat_buff",
          "unlock_stage": 15,
          "per_level": {
            "agility_max_stamina_bonus": 1,
            "agility_stamina_mod_proc_chance_bonus": 0.0002
          },
          "cap": 5,
          "base_cost": 50
        },
        {
          "id": "perception_stat_buff",
          "unlock_stage": 22,
          "per_level": {
            "perception_loot_mod_proc_chance_bonus": 0.0001,
            "perception_armor_penetration_percent_bonus": 0.01
          },
          "cap": 5,
          "base_cost": 150
        },
        {
          "id": "fragment_gain_multiplier",
          "unlock_stage": 36,
          "per_level": { "fragment_gain_multiplier": 1.25 },
          "cap": 1,
          "flat_cost": 9000
        }
      ],
      "epic": [
        {
          "id": "flat_damage_super_crit",
          "unlock_stage": 9,
          "per_level": {
            "flat_damage": 2,
            "super_crit_chance": 0.0035
          },
          "cap": 25,
          "base_cost": 3.5
        },
        {
          "id": "exp_and_fragment_gain",
          "unlock_stage": 10,
          "per_level": {
            "archaeology_exp_gain_percent": 0.03,
            "fragment_gain_percent": 0.02
          },
          "cap": 20,
          "base_cost": 5
        },
        {
          "id": "flurry_buff",
          "unlock_stage": 11,
          "per_level": {
            "flurry_stamina_on_cast": 1,
            "flurry_cooldown_attacks": -1
          },
          "cap": 10,
          "base_cost": 7.5
        },
        {
          "id": "max_stamina_stamina_mod_gain",
          "unlock_stage": 12,
          "per_level": {
            "max_stamina": 4,
            "stamina_mod_gain": 1
          },
          "cap": 5,
          "base_cost": 25
        },
        {
          "id": "intellect_stat_buff",
          "unlock_stage": 24,
          "per_level": {
            "intellect_exp_gain_percent_bonus": 0.01,
            "intellect_exp_mod_proc_chance_bonus": 0.0001
          },
          "cap": 5,
          "base_cost": 125
        },
        {
          "id": "stamina_mod_gain_epic",
          "unlock_stage": 38,
          "per_level": { "stamina_mod_gain": 2 },
          "cap": 1,
          "flat_cost": 8000
        }
      ],
      "legendary": [
        {
          "id": "exp_gain_max_stamina_percent",
          "unlock_stage": 17,
          "per_level": {
            "archaeology_exp_gain_percent": 0.05,
            "max_stamina_percent": 0.01
          },
          "cap": 15,
          "base_cost": 7
        },
        {
          "id": "armor_pen_ability_cooldown",
          "unlock_stage": 18,
          "per_level": {
            "armor_penetration_percent": 0.02,
            "all_ability_cooldown_attacks": -1
          },
          "cap": 10,
          "base_cost": 9
        },
        {
          "id": "crit_and_super_crit_damage",
          "unlock_stage": 20,
          "per_level": {
            "crit_damage_percent": 0.02,
            "super_crit_damage_percent": 0.02
          },
          "cap": 20,
          "base_cost": 12
        },
        {
          "id": "quake_buff",
          "unlock_stage": 20,
          "per_level": {
            "quake_attacks_per_activation": 1,
            "quake_cooldown_attacks": -2
          },
          "cap": 10,
          "base_cost": 15
        },
        {
          "id": "all_mod_chances",
          "unlock_stage": 40,
          "per_level": { "all_mod_proc_chance_percent": 0.015 },
          "cap": 1,
          "flat_cost": 7000
        }
      ],
      "mythic": [
        {
          "id": "damage_percent_flat_armor_pen",
          "unlock_stage": 26,
          "per_level": {
            "damage_percent": 0.02,
            "flat_armor_penetration": 3
          },
          "cap": 20,
          "base_cost": 6
        },
        {
          "id": "super_crit_ultra_crit_chance",
          "unlock_stage": 28,
          "per_level": {
            "super_crit_chance": 0.0035,
            "ultra_crit_chance": 0.01
          },
          "cap": 20,
          "base_cost": 10
        },
        {
          "id": "exp_mod_gain_and_chance",
          "unlock_stage": 30,
          "per_level": {
            "exp_mod_multiplier_gain": 0.1,
            "exp_mod_proc_chance": 0.001
          },
          "cap": 20,
          "base_cost": 15
        },
        {
          "id": "instacharge_max_stamina_per_hit",
          "unlock_stage": 32,
          "per_level": {
            "ability_instacharge_chance": 0.003,
            "max_stamina_per_hit": 4
          },
          "cap": 20,
          "base_cost": 20,
          "_uncertain": "max_stamina +4 assumed per hit; not yet confirmed in-game"
        },
        {
          "id": "exp_gain_2x_stat_caps",
          "unlock_stage": 42,
          "per_level": {
            "archaeology_exp_gain_multiplier": 2,
            "stat_point_level_cap_bonus": 5,
            "stat_caps_affected": ["strength", "agility", "perception", "intellect", "luck", "divinity", "corruption"]
          },
          "cap": 1,
          "flat_cost": 5000
        }
      ]
    }
  },

  "gem_upgrades": {
    "_note": "Paid with gems (outside fragment currencies). Effective level cap is min(nominal_cap, archaeology_level + 4) — e.g. all three cap at 5 when archaeology level is 1; stamina track reaches nominal 50 at archaeology level 46.",
    "effective_cap_formula": "min(nominal_cap, archaeology_level + 4)",
    "cost": {
      "growth_per_level": 1.05,
      "formula": "int(base_cost * 1.05^(level - 1))",
      "max_cost_before_first_ascension": 1000,
      "after_ascension_1": "no max_cost cap; costs continue scaling at 1.05×"
    },
    "upgrades": [
      {
        "id": "gem_stamina_and_stamina_mod",
        "per_level": {
          "max_stamina": 2,
          "stamina_mod_proc_chance": 0.005
        },
        "nominal_cap": 50,
        "base_cost": 300,
        "verified_costs": [300, 315, 330, 347, 364, 382, 402, 422]
      },
      {
        "id": "gem_exp_and_exp_mod",
        "per_level": {
          "archaeology_exp_gain_percent": 0.05,
          "experience_mod_proc_chance": 0.005
        },
        "nominal_cap": 25,
        "base_cost": 400,
        "verified_costs": [400, 420, 441, 463, 486, 510]
      },
      {
        "id": "gem_fragment_and_loot_mod",
        "per_level": {
          "fragment_gain_percent": 0.02,
          "loot_mod_proc_chance": 0.005
        },
        "nominal_cap": 25,
        "base_cost": 500,
        "verified_costs": [500, 525, 551]
      }
    ]
  },

  "terminology": {
    "stage": "Same as floor for calculator purposes unless specified otherwise.",
    "floor": "Alias of stage.",
    "block": "Same as rock."
  }
}
;
function cloneLookup(raw) {
  if (typeof structuredClone === "function") return structuredClone(raw);
  return JSON.parse(JSON.stringify(raw));
}
function readInlineLookupJson() {
  if (typeof document === "undefined") return null;
  const el = document.getElementById("archaeology-lookup-json");
  if (!el || !el.textContent || !el.textContent.trim()) return null;
  try { return JSON.parse(el.textContent); } catch (e) { return null; }
}
function lookupFetchUrls() {
  const urls = [];
  if (typeof document !== "undefined" && document.baseURI) {
    try { urls.push(new URL("lookup.json", document.baseURI).href); } catch (e) {}
  }
  if (typeof location !== "undefined" && location.href) {
    try { urls.push(new URL("lookup.json", new URL(".", location.href)).href); } catch (e) {}
  }
  return [...new Set(urls)];
}
async function fetchLookupJson() {
  for (const url of lookupFetchUrls()) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.upgrades && data.upgrades.by_fragment_tier) return data;
    } catch (e) {}
  }
  return null;
}
async function loadEmbeddedLookup() {
  if (embeddedCache) return embeddedCache;
  const inline = readInlineLookupJson();
  const raw = inline || LOOKUP_JSON;
  embeddedCache = indexLookup(cloneLookup(raw));
  return embeddedCache;
}
async function loadLookup() {
  const fetched = await fetchLookupJson();
  if (fetched) return indexLookup(fetched);
  return loadEmbeddedLookup();
}
return { indexLookup, loadLookup, loadEmbeddedLookup };

})();
const { loadLookup } = modules["lookup-index"];
const {
  clampStatLevels,
  computeCombat,
  STAT_IDS,
  statCap,
  sumAllocated,
  totalStatBudget,
} = modules["build"];
const { renderBuildReport } = modules["build-report-ui"];
const { runFragmentMonteCarlo, runMonteCarlo, runXpMonteCarlo } = modules["sim"];
const { optimizePushStatsAsync } = modules["push-optimizer"];
const { optimizeXpStatsAsync } = modules["xp-optimizer"];
const { optimizeFragmentStatsAsync } = modules["fragment-optimizer"];
const {
  fragmentCurrencies,
  fragmentCurrencyLabel,
  formatFragPerHour,
  isFragmentFarmable,
  minFarmStageForCurrency,
} = modules["fragment-farm"];
const {
  initUpgradeUI,
  getUpgradeLevelsByTier,
  getGemLevels,
} = modules["upgrade-ui"];
const { bindInputBlock, bindStatInputs } = modules["ui-controls"];
const { readBuildFieldsFromDom } = modules["calculator-state"];
const {
  bindUnlockListeners,
  refreshUnlockUI,
  setUpgradeUnlockStagesFromLookup,
} = modules["unlock-ui"];
const {
  initCardUI,
  refreshCardTierHint,
  syncCardUiFromStore,
  syncCardsFromDom,
} = modules["card-ui"];
const { buildCardContext, cardCoverageAtStage } = modules["cards"];
let lookup = null;
let lastRecommendedStats = null;
let lastRecommendedMode = null;

function $(id) {
  return document.getElementById(id);
}

function readBuild() {
  window.ArchaeologyStore?.syncFromDom?.();
  syncCardsFromDom();
  const fields = readBuildFieldsFromDom(STAT_IDS);
  const st = window.ArchaeologyStore?.state;
  const merged = {
    ...fields,
    block_cards: { ...(fields.block_cards || st?.block_cards || {}) },
    misc_card_quality: fields.misc_card_quality ?? st?.misc_card_quality ?? "",
    upgrade_levels: getUpgradeLevelsByTier(),
    gem_levels: getGemLevels(),
  };
  merged.stat_levels = clampStatLevels(
    merged.stat_levels || {},
    merged,
    lookup,
  );
  return merged;
}

function persistBuild() {
  window.ArchaeologyStore?.saveState();
}

const FALLBACK_STAT_CAPS = {
  strength: 50,
  agility: 50,
  perception: 25,
  intellect: 25,
  luck: 25,
  divinity: 10,
  corruption: 10,
};

function fallbackStatCap(statId, build) {
  const asc = build.ascension ?? 0;
  if (statId === "divinity" && asc < 1) return 0;
  if (statId === "corruption" && asc < 2) return 0;
  let cap = FALLBACK_STAT_CAPS[statId] ?? 0;
  const mythic =
    build.upgrade_levels?.mythic?.exp_gain_2x_stat_caps ??
    window.ArchaeologyStore?.state?.levels?.exp_gain_2x_stat_caps ??
    0;
  if (mythic > 0) cap += 5 * mythic;
  return cap;
}

const STAT_UNLOCK_ASCENSION = {
  strength: 0,
  agility: 0,
  perception: 0,
  intellect: 0,
  luck: 0,
  divinity: 1,
  corruption: 2,
};

const STAT_CAP_LABEL = {
  strength: 50,
  agility: 50,
  perception: 25,
  intellect: 25,
  luck: 25,
  divinity: 10,
  corruption: 10,
};

function ensureStatInputs() {
  const host = $("statInputs");
  if (!host) return;

  if (!host.querySelector(".stat-slot")) {
    for (const id of STAT_IDS) {
      const needAsc = STAT_UNLOCK_ASCENSION[id] ?? 0;
      const cap = STAT_CAP_LABEL[id] ?? 0;
      const row = document.createElement("div");
      row.className = "stat-slot";
      row.dataset.statId = id;
      row.dataset.unlockAscension = String(needAsc);
      row.innerHTML = `
        <div class="upgrade-top">
          <div class="benefit-list">
            <span class="benefit-line">${id.charAt(0).toUpperCase() + id.slice(1)}</span>
            <div class="meta">Cap: ${cap}</div>
          </div>
          <div class="lvl-controls">
            <button type="button" class="btn btn-step" data-delta="-5">−5</button>
            <button type="button" class="btn btn-step" data-delta="-1">−1</button>
            <input class="lvl" type="number" min="0" step="1" id="stat-${id}" value="0" />
            <button type="button" class="btn btn-step" data-delta="1">+1</button>
            <button type="button" class="btn btn-step" data-delta="5">+5</button>
          </div>
        </div>`;
      const input = row.querySelector(`#stat-${id}`);
      if (input) input.value = String(window.ArchaeologyStore?.state.stat_levels[id] ?? 0);
      host.appendChild(row);
    }
  }
}

function writeStats(sl) {
  for (const id of STAT_IDS) {
    const el = $(`stat-${id}`);
    if (el) el.value = sl[id] ?? 0;
    if (window.ArchaeologyStore) window.ArchaeologyStore.state.stat_levels[id] = sl[id] ?? 0;
  }
  updateBudgetLine();
  persistBuild();
  document.dispatchEvent(new CustomEvent("archaeology-build-change"));
}

function updateBudgetLine() {
  if (window.ArchaeologyStore?.applyBudgetLine) {
    window.ArchaeologyStore.applyBudgetLine();
    return;
  }
  const build = readBuild();
  const sum = sumAllocated(build.stat_levels || {});
  const budget = totalStatBudget(build);
  const line = $("budget-line");
  if (!line) return;
  line.textContent = `Stat points: ${sum} / ${budget}`;
  line.classList.toggle("over", sum > budget);
}

function formatHist(hist) {
  return [...hist.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 14)
    .map(([s, c]) => `Stage ${s}: ${c}`)
    .join("\n");
}

function showPushResults(mc, combat, note = "") {
  const inner = $("push-results-inner");
  if (!inner) return;
  inner.innerHTML = `
    <div class="results-metrics">
      <div class="metric"><span>E[max stage]</span><strong>${mc.mean.toFixed(2)}</strong></div>
      <div class="metric"><span>Median</span><strong>${mc.percentiles[0.5]}</strong></div>
      <div class="metric"><span>P95</span><strong>${mc.percentiles[0.95]}</strong></div>
    </div>
    <p class="note">${note}${mc.trials} MC trials. DMG/hit≈${combat.expectedDamage.toFixed(2)}, stamina=${combat.maxStamina}</p>
    <pre class="hist-pre">${formatHist(mc.hist)}</pre>
  `;
}

function showRecommendedStats(sl, mode = "push") {
  const build = readBuild();
  const clamped = lookup
    ? clampStatLevels(sl, build, lookup)
    : Object.fromEntries(STAT_IDS.map((id) => [id, Math.max(0, sl[id] || 0)]));
  lastRecommendedStats = { ...clamped };
  lastRecommendedMode = mode;

  const rows = STAT_IDS.map((id) => {
    const cur = parseInt($(`stat-${id}`)?.value, 10) || 0;
    const rec = clamped[id] ?? 0;
    const changed = cur !== rec ? "rec-diff" : "";
    return `<div class="row ${changed}"><span class="k">${id}</span><span>yours ${cur} → <strong>${rec}</strong></span></div>`;
  }).join("");

  if (mode === "xp") {
    const panel = $("recommended-stats-xp");
    if (panel) panel.classList.remove("hidden");
    $("recommended-stats-xp-body").innerHTML = rows;
    $("btn-apply-stats-xp").disabled = false;
    return;
  }

  if (mode === "fragment") {
    const panel = $("recommended-stats-fragment");
    if (panel) panel.classList.remove("hidden");
    $("recommended-stats-fragment-body").innerHTML = rows;
    $("btn-apply-stats-fragment").disabled = false;
    return;
  }

  const panel = $("recommended-stats");
  if (panel) panel.classList.remove("hidden");
  $("btn-apply-stats").disabled = false;
  $("recommended-stats-body").innerHTML = rows;
}

function applyRecommendedStats() {
  if (!lastRecommendedStats) return;
  writeStats(lastRecommendedStats);
  const modeLabel =
    lastRecommendedMode === "xp"
      ? "XP"
      : lastRecommendedMode === "fragment"
        ? "fragment"
        : "push";
  const msg = `Applied recommended stats (${modeLabel} optimizer).`;
  if (lastRecommendedMode === "xp") {
    $("xp-status").textContent = msg;
    $("xp-status").classList.add("good");
  } else if (lastRecommendedMode === "fragment") {
    $("fragment-status").textContent = msg;
    $("fragment-status").classList.add("good");
  } else {
    $("push-status").textContent = msg;
    $("push-status").classList.add("good");
  }
}

function selectedFragmentCurrency() {
  const checked = document.querySelector('input[name="fragment-target"]:checked');
  return checked?.value || "common";
}

function refreshFragmentPicker() {
  const host = $("fragment-choices");
  const note = $("fragment-bounds-note");
  if (!host || !lookup) return;

  const build = readBuild();
  const highest = build.highest_stage ?? 1;
  const currencies = fragmentCurrencies(lookup);
  const prev = selectedFragmentCurrency();
  let anyOob = false;
  let firstFarmable = null;

  host.innerHTML = currencies
    .map((cur) => {
      const farmable = isFragmentFarmable(highest, lookup, cur);
      const minStage = minFarmStageForCurrency(lookup, cur);
      if (!farmable) anyOob = true;
      else if (!firstFarmable) firstFarmable = cur;
      const label = fragmentCurrencyLabel(cur);
      const checked = prev === cur && farmable ? "checked" : "";
      const disabled = farmable ? "" : "disabled";
      const oobClass = farmable ? "" : " out-of-bounds";
      const title = farmable
        ? `Farmable at max floor ${highest} (spawns from stage ${minStage})`
        : `Requires max floor ≥ ${minStage} (yours: ${highest})`;
      return `<label class="fragment-choice${oobClass}" title="${title}">
        <input type="radio" name="fragment-target" value="${cur}" ${disabled} ${checked} />
        <span>${label}</span>
      </label>`;
    })
    .join("");

  const selectedStillOk = isFragmentFarmable(highest, lookup, prev);
  if (!selectedStillOk && firstFarmable) {
    const input = host.querySelector(`input[value="${firstFarmable}"]`);
    if (input) input.checked = true;
  } else if (!host.querySelector('input[name="fragment-target"]:checked') && firstFarmable) {
    const input = host.querySelector(`input[value="${firstFarmable}"]`);
    if (input) input.checked = true;
  }

  if (note) {
    if (anyOob) {
      note.classList.remove("hidden");
      note.textContent =
        "Grayed-out fragments are out of bounds at your current max floor — run the push optimizer and raise highest stage to farm them.";
    } else {
      note.classList.add("hidden");
      note.textContent = "";
    }
  }

  const cur = selectedFragmentCurrency();
  const canRun = isFragmentFarmable(highest, lookup, cur);
  $("btn-fragment-preview")?.toggleAttribute("disabled", !canRun);
  $("btn-fragment-optimize")?.toggleAttribute("disabled", !canRun);
}

function formatFragHist(hist, lookup, binWidth = 0.5) {
  const half = binWidth / 2;
  return [...hist.entries()]
    .sort((a, b) => b[0] - a[0])
    .filter(([, c]) => c > 0)
    .slice(0, 14)
    .map(([center, c]) => {
      const lo = Math.max(0, center - half);
      const hi = center + half;
      const label =
        binWidth >= 0.25
          ? `${formatFragPerHour(lo, lookup)}–${formatFragPerHour(hi, lookup)}`
          : formatFragPerHour(center, lookup);
      return `${label}/hr: ${c} runs`;
    })
    .join("\n");
}

function showFragmentResults(mc, note = "", build = null) {
  const inner = $("fragment-results-inner");
  if (!inner || !lookup) return;
  const label = fragmentCurrencyLabel(mc.targetCurrency);
  const covHtml = build ? cardCoverageNote(build) : "";
  const ratioHr = mc.ratioOfMeansFragPerHour ?? 0;
  inner.innerHTML = `
    <div class="results-metrics">
      <div class="metric"><span>E[${label}/hr]</span><strong>${formatFragPerHour(mc.meanFragPerHour, lookup)}</strong></div>
      <div class="metric"><span>Frag/hr (ratio÷means)</span><strong>${formatFragPerHour(ratioHr, lookup)}</strong></div>
      <div class="metric"><span>E[frags/run]</span><strong>${mc.meanFragments.toFixed(3)}</strong></div>
      <div class="metric"><span>E[sec/run]</span><strong>${(mc.meanSeconds ?? 0).toFixed(1)}</strong></div>
      <div class="metric"><span>E[max stage]</span><strong>${mc.meanMaxStage.toFixed(2)}</strong></div>
      <div class="metric"><span>P50 frag/hr</span><strong>${formatFragPerHour(mc.percentiles?.[0.5] ?? 0, lookup)}</strong></div>
      <div class="metric"><span>P90</span><strong>${formatFragPerHour(mc.percentiles?.[0.9] ?? 0, lookup)}</strong></div>
      <div class="metric"><span>Range</span><strong>${formatFragPerHour(mc.minFragPerHour ?? 0, lookup)}–${formatFragPerHour(mc.maxFragPerHour ?? 0, lookup)}</strong></div>
    </div>
    ${covHtml}
    <p class="note">${note}${mc.trials} MC trials for <strong>${label}</strong>. Histogram: ${mc.histBinWidth ?? 0.5} frag/hr bins (grouped ranges).</p>
    <pre class="hist-pre">${mc.hist ? formatFragHist(mc.hist, lookup, mc.histBinWidth) : ""}</pre>
  `;
}

function formatXpHist(hist) {
  return [...hist.entries()]
    .sort((a, b) => b[0] - a[0])
    .filter(([, c]) => c > 0)
    .slice(0, 14)
    .map(([xpHr, c]) => `${xpHr.toLocaleString()} XP/hr: ${c} runs`)
    .join("\n");
}

function cardCoverageNote(build) {
  if (!lookup) return "";
  const stage = build.highest_stage || 1;
  const cardCtx = buildCardContext(build, lookup);
  const cov = cardCoverageAtStage(stage, lookup, cardCtx);
  if (cov.cardsConfigured === 0) {
    return `<p class="note warn">No block cards configured — sim treats all blocks as uncarded.</p>`;
  }
  if (cov.spawnMatchPct < 5) {
    return `<p class="note warn">At stage ${stage}, only ${cov.spawnMatchPct.toFixed(0)}% of fragment spawns match a card you set (wrong tier columns?). Avg exp/loot mult on spawns: ${cov.avgExpLootMult.toFixed(2)}×. See tier hint above.</p>`;
  }
  return `<p class="note">Cards at stage ${stage}: ${cov.spawnMatchPct.toFixed(0)}% of fragment spawns matched, avg exp/loot ${cov.avgExpLootMult.toFixed(2)}× on spawns.</p>`;
}

function showXpResults(mc, note = "", build = null) {
  const inner = $("xp-results-inner");
  if (!inner) return;
  const covHtml = build ? cardCoverageNote(build) : "";
  const ratioHr = mc.ratioOfMeansXpPerHour ?? 0;
  const ratioGap =
    mc.meanXpPerHour > 0
      ? ((ratioHr / mc.meanXpPerHour - 1) * 100).toFixed(1)
      : "0";
  inner.innerHTML = `
    <div class="results-metrics">
      <div class="metric"><span>E[XP/hr]</span><strong>${Math.round(mc.meanXpPerHour).toLocaleString()}</strong></div>
      <div class="metric"><span>XP/hr (ratio÷means)</span><strong>${Math.round(ratioHr).toLocaleString()}</strong></div>
      <div class="metric"><span>E[XP/run]</span><strong>${mc.meanXp.toFixed(1)}</strong></div>
      <div class="metric"><span>E[sec/run]</span><strong>${(mc.meanSeconds ?? 0).toFixed(1)}</strong></div>
      <div class="metric"><span>E[max stage]</span><strong>${mc.meanMaxStage.toFixed(2)}</strong></div>
      <div class="metric"><span>P50 XP/hr</span><strong>${Math.round(mc.percentiles[0.5]).toLocaleString()}</strong></div>
      <div class="metric"><span>P90</span><strong>${Math.round(mc.percentiles[0.9] ?? 0).toLocaleString()}</strong></div>
      <div class="metric"><span>Range</span><strong>${Math.round(mc.minXpPerHour ?? 0)}–${Math.round(mc.maxXpPerHour ?? 0)}</strong></div>
    </div>
    ${covHtml}
    <p class="note">${note}${mc.trials} MC trials. <strong>E[XP/hr]</strong> = mean of each run’s XP÷time (primary). <strong>Ratio÷means</strong> = sum(XP)÷sum(time) (some other tools); gap here ${ratioGap}%. Histogram: 50 XP/hr bins.</p>
    <pre class="hist-pre">${formatXpHist(mc.hist)}</pre>
  `;
}

function showLoadError(msg) {
  const loadErr = $("load-error");
  if (loadErr) {
    loadErr.classList.remove("hidden");
    loadErr.textContent = msg;
  }
  const status = $("push-status");
  if (status) {
    status.textContent = msg;
    status.classList.remove("good");
    status.classList.add("bad");
  }
}

function requireLookup() {
  if (lookup) return true;
  showLoadError(
    "Game data not loaded. Upload the full calculator folder (index.html, lookup.json, and every file in js/ including lookup-data.js).",
  );
  return false;
}

const requireLookupForPush = requireLookup;
const requireLookupForXp = requireLookup;

async function onPreview() {
  if (!requireLookupForPush()) return;
  const build = readBuild();
  $("push-status").textContent = "Running preview with your current stats…";
  $("push-status").classList.remove("good", "bad");
  $("btn-preview").disabled = true;
  await new Promise((r) => setTimeout(r, 0));
  try {
    const combat = computeCombat(build, lookup);
    const trials = parseInt($("mc-trials").value, 10) || 500;
    const mc = runMonteCarlo(build, lookup, { trials, seed: 42 });
    showPushResults(mc, combat, "Preview (your stats). ");
    $("push-status").textContent = `Preview complete (${trials} trials).`;
    $("push-status").classList.add("good");
  } catch (e) {
    $("push-status").textContent = `Error: ${e.message}`;
    $("push-status").classList.add("bad");
  } finally {
    $("btn-preview").disabled = false;
  }
}

async function onOptimize() {
  if (!requireLookupForPush()) return;

  const build = readBuild();
  const sum = sumAllocated(build.stat_levels || {});
  const budget = totalStatBudget(build);
  if (sum > budget) {
    $("push-status").textContent = `Stat points ${sum} exceed archaeology level ${budget} — lower stats above first.`;
    $("push-status").classList.remove("good");
    $("push-status").classList.add("bad");
    return;
  }

  const trials = parseInt($("mc-trials").value, 10) || 600;
  const coarseTrials = Math.max(80, Math.min(120, Math.floor(trials / 5)));
  const refineTrials = Math.max(200, Math.min(trials, Math.floor(trials * 0.6)));
  $("btn-optimize").disabled = true;
  $("btn-preview").disabled = true;
  $("push-status").textContent = "Optimizing stat allocation (upgrades fixed)…";
  $("push-status").classList.remove("good", "bad");
  await new Promise((r) => setTimeout(r, 0));

  try {
    const result = await optimizePushStatsAsync(
      build,
      lookup,
      { coarseTrials, refineTrials, reportTrials: trials, seed: 12345 },
      (p) => {
        if (p.phase === "coarse") {
          $("push-status").textContent = `Screening ${p.index}/${p.total}… best stage≈${p.bestMean.toFixed(2)}${p.tag ? ` (${p.tag})` : ""}`;
        } else if (p.phase === "refine") {
          const hill =
            p.hillIter != null
              ? `, hill ${p.hillIter}${p.hillMax ? `/${p.hillMax}` : ""}`
              : "";
          const tag =
            p.tag && p.tag !== "starting" ? ` (${p.tag})` : p.tag === "starting" ? "…" : "";
          $("push-status").textContent = `Refining seed ${p.index}/${p.total}${tag} best≈${p.bestMean.toFixed(2)}${hill}`;
        } else if (p.phase === "final") {
          if (p.tag === "full-report") {
            $("push-status").textContent = `Building final histogram… best≈${p.bestMean.toFixed(2)}`;
          } else {
            $("push-status").textContent = `Confirming ${p.index}/${p.total}…`;
          }
        }
      },
    );

    showRecommendedStats(result.stat_levels, "push");

    const previewBuild = {
      ...build,
      stat_levels: result.stat_levels,
    };
    const combat = computeCombat(previewBuild, lookup);
    showPushResults(
      result.mc,
      combat,
      `Optimized stats (${result.iterations} hill-climb iters). Your stat inputs unchanged — use Apply below. `,
    );
    $("push-status").textContent = "Optimization complete. Review recommended stats, then Apply if desired.";
    $("push-status").classList.add("good");
  } catch (e) {
    $("push-status").textContent = `Error: ${e.message}`;
    $("push-status").classList.add("bad");
  } finally {
    $("btn-optimize").disabled = !lookup;
    $("btn-preview").disabled = !lookup;
  }
}

function resetStats() {
  writeStats(Object.fromEntries(STAT_IDS.map((id) => [id, 0])));
}

function updateBuildReport() {
  renderBuildReport($("build-report"), readBuild(), lookup);
}

/** Refresh budget line, combat stats, and lock states from current store + DOM. */
function refreshBuildUi() {
  window.ArchaeologyStore?.syncFromDom?.();
  updateBudgetLine();
  updateBuildReport();
  if (lookup) refreshUnlockUI();
}

function onBuildChange() {
  refreshBuildUi();
  refreshCardTierHint(lookup);
  refreshFragmentPicker();
  persistBuild();
}

async function onXpPreview() {
  if (!requireLookupForXp()) return;
  const build = readBuild();
  $("xp-status").textContent = "Running XP preview…";
  $("xp-status").classList.remove("good", "bad");
  $("btn-xp-preview").disabled = true;
  await new Promise((r) => setTimeout(r, 0));
  try {
    const trials = parseInt($("mc-trials").value, 10) || 500;
    const mc = runXpMonteCarlo(build, lookup, { trials, seed: 43 });
    showXpResults(mc, "Preview (your stats). ", build);
    $("xp-status").textContent = `Preview complete (${trials} trials).`;
    $("xp-status").classList.add("good");
  } catch (e) {
    $("xp-status").textContent = `Error: ${e.message}`;
    $("xp-status").classList.add("bad");
  } finally {
    $("btn-xp-preview").disabled = false;
  }
}

async function onXpOptimize() {
  if (!requireLookupForXp()) return;

  const build = readBuild();
  const sum = sumAllocated(build.stat_levels || {});
  const budget = totalStatBudget(build);
  if (sum > budget) {
    $("xp-status").textContent = `Stat points ${sum} exceed archaeology level ${budget} — lower stats above first.`;
    $("xp-status").classList.remove("good");
    $("xp-status").classList.add("bad");
    return;
  }

  const trials = parseInt($("mc-trials").value, 10) || 600;
  const coarseTrials = Math.max(80, Math.min(150, Math.floor(trials / 5)));
  const refineTrials = Math.max(200, Math.min(trials, Math.floor(trials * 0.6)));
  $("btn-xp-optimize").disabled = true;
  $("btn-xp-preview").disabled = true;
  $("xp-status").textContent = "Optimizing for XP/hour…";
  $("xp-status").classList.remove("good", "bad");
  await new Promise((r) => setTimeout(r, 0));

  try {
    const result = await optimizeXpStatsAsync(
      build,
      lookup,
      {
        coarseTrials,
        refineTrials,
        reportTrials: trials,
        seed: 54321,
      },
      (p) => {
        if (p.phase === "coarse") {
          $("xp-status").textContent = `Screening ${p.index}/${p.total}… best≈${Math.round(p.bestMean).toLocaleString()}${p.tag ? ` (${p.tag})` : ""}`;
        } else if (p.phase === "refine") {
          const hill =
            p.hillIter != null
              ? `, hill ${p.hillIter}${p.hillMax ? `/${p.hillMax}` : ""}`
              : "";
          const tag =
            p.tag && p.tag !== "starting" ? ` (${p.tag})` : p.tag === "starting" ? "…" : "";
          $("xp-status").textContent = `Refining seed ${p.index}/${p.total}${tag} best≈${Math.round(p.bestMean).toLocaleString()}${hill}`;
        } else if (p.phase === "final") {
          if (p.tag === "full-report") {
            $("xp-status").textContent = `Building final histogram… best≈${Math.round(p.bestMean).toLocaleString()}`;
          } else {
            $("xp-status").textContent = `Confirming ${p.index}/${p.total}… best≈${Math.round(p.bestMean).toLocaleString()}`;
          }
        }
      },
    );

    showRecommendedStats(result.stat_levels, "xp");
    showXpResults(
      result.mc,
      `Optimized (${result.candidatesScreened} screened @ ${result.coarseTrials} MC, refined @ ${result.refineTrials}, confirmed @ ${trials}). `,
      { ...build, stat_levels: result.stat_levels },
    );
    $("xp-status").textContent = "XP optimization complete.";
    $("xp-status").classList.add("good");
  } catch (e) {
    $("xp-status").textContent = `Error: ${e.message}`;
    $("xp-status").classList.add("bad");
  } finally {
    $("btn-xp-optimize").disabled = !lookup;
    $("btn-xp-preview").disabled = !lookup;
  }
}

async function onFragmentPreview() {
  if (!requireLookupForXp()) return;
  const build = readBuild();
  const targetCurrency = selectedFragmentCurrency();
  if (!isFragmentFarmable(build.highest_stage, lookup, targetCurrency)) {
    $("fragment-status").textContent = "Selected fragment is out of bounds at your max floor.";
    $("fragment-status").classList.add("bad");
    return;
  }

  $("fragment-status").textContent = "Running fragment preview…";
  $("fragment-status").classList.remove("good", "bad");
  $("btn-fragment-preview").disabled = true;
  await new Promise((r) => setTimeout(r, 0));
  try {
    const trials = parseInt($("mc-trials").value, 10) || 500;
    const mc = runFragmentMonteCarlo(build, lookup, {
      trials,
      seed: 44,
      targetCurrency,
    });
    const label = fragmentCurrencyLabel(targetCurrency);
    showFragmentResults(mc, `Preview (your stats, ${label}). `, build);
    $("fragment-status").textContent = `Preview complete (${trials} trials).`;
    $("fragment-status").classList.add("good");
  } catch (e) {
    $("fragment-status").textContent = `Error: ${e.message}`;
    $("fragment-status").classList.add("bad");
  } finally {
    refreshFragmentPicker();
  }
}

async function onFragmentOptimize() {
  if (!requireLookupForXp()) return;

  const build = readBuild();
  const targetCurrency = selectedFragmentCurrency();
  if (!isFragmentFarmable(build.highest_stage, lookup, targetCurrency)) {
    $("fragment-status").textContent = "Selected fragment is out of bounds at your max floor.";
    $("fragment-status").classList.add("bad");
    return;
  }

  const sum = sumAllocated(build.stat_levels || {});
  const budget = totalStatBudget(build);
  if (sum > budget) {
    $("fragment-status").textContent = `Stat points ${sum} exceed archaeology level ${budget} — lower stats above first.`;
    $("fragment-status").classList.remove("good");
    $("fragment-status").classList.add("bad");
    return;
  }

  const trials = parseInt($("mc-trials").value, 10) || 600;
  const coarseTrials = Math.max(80, Math.min(150, Math.floor(trials / 5)));
  const refineTrials = Math.max(200, Math.min(trials, Math.floor(trials * 0.6)));
  const label = fragmentCurrencyLabel(targetCurrency);
  $("btn-fragment-optimize").disabled = true;
  $("btn-fragment-preview").disabled = true;
  $("fragment-status").textContent = `Optimizing for ${label}/hour…`;
  $("fragment-status").classList.remove("good", "bad");
  await new Promise((r) => setTimeout(r, 0));

  try {
    const result = await optimizeFragmentStatsAsync(
      build,
      lookup,
      {
        coarseTrials,
        refineTrials,
        reportTrials: trials,
        seed: 24680,
        targetCurrency,
      },
      (p) => {
        if (p.phase === "coarse") {
          $("fragment-status").textContent = `Screening ${p.index}/${p.total}… best≈${formatFragPerHour(p.bestMean, lookup)}${p.tag ? ` (${p.tag})` : ""}`;
        } else if (p.phase === "refine") {
          const hill =
            p.hillIter != null
              ? `, hill ${p.hillIter}${p.hillMax ? `/${p.hillMax}` : ""}`
              : "";
          const tag =
            p.tag && p.tag !== "starting" ? ` (${p.tag})` : p.tag === "starting" ? "…" : "";
          $("fragment-status").textContent = `Refining seed ${p.index}/${p.total}${tag} best≈${formatFragPerHour(p.bestMean, lookup)}${hill}`;
        } else if (p.phase === "final") {
          if (p.tag === "full-report") {
            $("fragment-status").textContent = `Building final histogram… best≈${formatFragPerHour(p.bestMean, lookup)}`;
          } else {
            $("fragment-status").textContent = `Confirming ${p.index}/${p.total}… best≈${formatFragPerHour(p.bestMean, lookup)}`;
          }
        }
      },
    );

    showRecommendedStats(result.stat_levels, "fragment");
    showFragmentResults(
      result.mc,
      `Optimized for ${label} (${result.candidatesScreened} screened @ ${result.coarseTrials} MC, refined @ ${result.refineTrials}, confirmed @ ${trials}). `,
      { ...build, stat_levels: result.stat_levels },
    );
    $("fragment-status").textContent = "Fragment optimization complete.";
    $("fragment-status").classList.add("good");
  } catch (e) {
    $("fragment-status").textContent = `Error: ${e.message}`;
    $("fragment-status").classList.add("bad");
  } finally {
    refreshFragmentPicker();
  }
}

function wirePushButtons() {
  $("btn-preview")?.addEventListener("click", onPreview);
  $("btn-optimize")?.addEventListener("click", onOptimize);
  $("btn-apply-stats")?.addEventListener("click", applyRecommendedStats);
  $("btn-xp-preview")?.addEventListener("click", onXpPreview);
  $("btn-xp-optimize")?.addEventListener("click", onXpOptimize);
  $("btn-apply-stats-xp")?.addEventListener("click", applyRecommendedStats);
  $("btn-fragment-preview")?.addEventListener("click", onFragmentPreview);
  $("btn-fragment-optimize")?.addEventListener("click", onFragmentOptimize);
  $("btn-apply-stats-fragment")?.addEventListener("click", applyRecommendedStats);
  $("btn-reset-stats")?.addEventListener("click", resetStats);
  $("fragment-choices")?.addEventListener("change", (ev) => {
    if (ev.target?.name === "fragment-target") refreshFragmentPicker();
  });
}

document.addEventListener("archaeology-build-change", onBuildChange);

async function init() {
  const loadErr = $("load-error");
  if (loadErr) loadErr.classList.add("hidden");

  wirePushButtons();
  window.__archaeologyOptimize = onOptimize;
  window.__archaeologyPreview = onPreview;
  window.__archaeologyXpOptimize = onXpOptimize;
  window.__archaeologyXpPreview = onXpPreview;
  window.__archaeologyFragmentOptimize = onFragmentOptimize;
  window.__archaeologyFragmentPreview = onFragmentPreview;
  window.__archaeologyRefreshUi = refreshBuildUi;

  try {
    window.ArchaeologyStore?.syncToDom();
    ensureStatInputs();
    initCardUI();
    initUpgradeUI();

    for (const id of ["arch-level", "ascension", "highest-stage"]) {
      bindInputBlock(id, {
        min: id === "ascension" ? 0 : 1,
        max: id === "ascension" ? 2 : Infinity,
        integer: true,
        onChange: onBuildChange,
      });
    }

    bindUnlockListeners(null);

    lookup = await loadLookup();
    window.__archaeologyLookup = lookup;
    if (loadErr) loadErr.classList.add("hidden");

    const getStatCap = (id) =>
      lookup ? statCap(id, readBuild(), lookup) : fallbackStatCap(id, readBuild());

    bindStatInputs(STAT_IDS, getStatCap);
    if (lookup) setUpgradeUnlockStagesFromLookup(lookup);

    bindUnlockListeners(lookup);
    refreshUnlockUI();

    bindInputBlock("mc-trials", {
      min: 100,
      max: 20000,
      integer: true,
      onChange: onBuildChange,
    });

    window.ArchaeologyStore?.syncToDom();
    syncCardUiFromStore();
    refreshCardTierHint(lookup);
    window.ArchaeologyStore?.applyUpgradeLocks?.();
    refreshBuildUi();
    document.dispatchEvent(new CustomEvent("archaeology-build-change"));

    const status = $("push-status");
    if (status && lookup) {
      status.textContent = "Ready — use Preview or Optimize stats below.";
      status.classList.remove("bad");
    }
    const xpStatus = $("xp-status");
    if (xpStatus && lookup) {
      xpStatus.textContent = "Ready — preview or optimize XP/hour below.";
      xpStatus.classList.remove("bad");
    }
    refreshFragmentPicker();
    const fragStatus = $("fragment-status");
    if (fragStatus && lookup) {
      fragStatus.textContent = "Ready — pick a fragment, then preview or optimize.";
      fragStatus.classList.remove("bad");
    }
  } catch (e) {
    console.error("Archaeology Calculator init failed:", e);
    showLoadError(`Calculator failed to start: ${e.message}`);
  }
}


init().catch(function(e) {
  console.error(e);
  showLoadError("Calculator failed to start: " + e.message);
});

})();
