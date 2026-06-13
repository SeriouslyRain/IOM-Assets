/**
 * In-memory build state + localStorage (same pattern as Event Calculator).
 * Classic script — no ES modules — so it always runs before/with the page.
 */
(function () {
  var STORAGE_KEY = "archaeology_calculator_build_v1";
  var LEGACY_KEY = "archaeology_push_calculator_v1";
  var STORAGE_CONSENT_KEY = "archaeology_calculator_storage_ok_v1";
  var OPTIMIZER_RESULTS_KEY = "archaeology_optimizer_results_v1";

  var STAT_IDS = [
    "strength",
    "agility",
    "perception",
    "intellect",
    "luck",
    "divinity",
    "corruption",
  ];

  var state = {
    archaeology_level: 1,
    ascension: 0,
    highest_stage: 1,
    has_block_bonker: false,
    has_avada_keda: false,
    has_fragment_bundle: false,
    has_cave_legendary_fish_level_1_tribute: false,
    mythic_chests_owned: 0,
    has_axolotl_skin_quest: false,
    axolotl_skin_quest_level: 1,
    mc_trials: 600,
    custom_trials_enabled: false,
    abilities: { enrage: true, flurry: true, quake: true },
    stat_levels: {},
    levels: {},
    block_cards: {},
    misc_card_quality: "",
  };

  var lockListenersBound = false;
  var bootComplete = false;
  var saveStatusEl = null;

  function currentHighestStage() {
    var el = document.getElementById("highest-stage");
    if (el) {
      var v = parseInt(el.value, 10);
      if (Number.isFinite(v) && v >= 1) return v;
    }
    return state.highest_stage >= 1 ? state.highest_stage : 1;
  }

  function unlockStageForRow(row) {
    var raw = row.getAttribute("data-unlock-stage");
    if (raw != null && raw !== "") {
      var n = parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    }
    return 999;
  }

  function applyUpgradeLockStates() {
    var stage = currentHighestStage();
    document.querySelectorAll(".upgrade[data-upgrade-id]").forEach(function (row) {
      var tier = row.getAttribute("data-tier");
      if (tier === "gem") return;
      var need = unlockStageForRow(row);
      var locked = stage < need;
      row.classList.toggle("locked", locked);
      row.querySelectorAll("input, button").forEach(function (ctrl) {
        ctrl.disabled = locked;
        ctrl.classList.toggle("locked", locked);
      });
      var meta = row.querySelector(".meta");
      if (!meta) return;
      if (!meta.dataset.capText) {
        meta.dataset.capText = (meta.textContent || "").split(" · ")[0].trim();
      }
      meta.textContent = locked
        ? meta.dataset.capText + " · Unlocks at stage " + need
        : meta.dataset.capText;
    });
    document.querySelectorAll(".upgrades-grid > .panel").forEach(function (panel) {
      var upgrades = panel.querySelectorAll(
        '.upgrade[data-upgrade-id]:not([data-tier="gem"])',
      );
      var anyOpen = false;
      for (var i = 0; i < upgrades.length; i++) {
        if (stage >= unlockStageForRow(upgrades[i])) {
          anyOpen = true;
          break;
        }
      }
      panel.classList.toggle("tier-locked", upgrades.length > 0 && !anyOpen);
    });
  }

  function applyBudgetLine() {
    var line = document.getElementById("budget-line");
    if (!line) return;
    var sum = 0;
    STAT_IDS.forEach(function (id) {
      sum += state.stat_levels[id] || 0;
    });
    var budget = state.archaeology_level >= 1 ? state.archaeology_level : 1;
    line.textContent = "Stat points: " + sum + " / " + budget;
    line.classList.toggle("over", sum > budget);
  }

  function bindLockListeners() {
    if (lockListenersBound) return;
    lockListenersBound = true;
    document.addEventListener("archaeology-build-change", function () {
      applyUpgradeLockStates();
      applyBudgetLine();
    });
  }

  function initState() {
    state.archaeology_level = 1;
    state.ascension = 0;
    state.highest_stage = 1;
    state.has_block_bonker = false;
    state.has_avada_keda = false;
    state.has_fragment_bundle = false;
    state.has_cave_legendary_fish_level_1_tribute = false;
    state.mythic_chests_owned = 0;
    state.has_axolotl_skin_quest = false;
    state.axolotl_skin_quest_level = 1;
    state.mc_trials = 600;
    state.custom_trials_enabled = false;
    state.abilities = { enrage: true, flurry: true, quake: true };
    state.stat_levels = {};
    state.levels = {};
    state.block_cards = {};
    state.misc_card_quality = "";
    STAT_IDS.forEach(function (id) {
      state.stat_levels[id] = 0;
    });
    document.querySelectorAll(".upgrade[data-upgrade-id]").forEach(function (el) {
      var id = el.getAttribute("data-upgrade-id");
      if (id) state.levels[id] = 0;
    });
  }

  function applySnapshot(parsed) {
    if (!parsed || typeof parsed !== "object") return;
    if (typeof parsed.archaeology_level === "number" && parsed.archaeology_level >= 1) {
      state.archaeology_level = Math.floor(parsed.archaeology_level);
    }
    if (typeof parsed.ascension === "number" && parsed.ascension >= 0) {
      state.ascension = Math.floor(parsed.ascension);
    }
    if (typeof parsed.highest_stage === "number" && parsed.highest_stage >= 1) {
      state.highest_stage = Math.floor(parsed.highest_stage);
    }
    if (typeof parsed.mc_trials === "number" && parsed.mc_trials >= 1) {
      state.mc_trials = Math.floor(parsed.mc_trials);
    }
    if (typeof parsed.custom_trials_enabled === "boolean") {
      state.custom_trials_enabled = parsed.custom_trials_enabled;
    }
    if (typeof parsed.has_block_bonker === "boolean") {
      state.has_block_bonker = parsed.has_block_bonker;
    }
    if (typeof parsed.has_avada_keda === "boolean") {
      state.has_avada_keda = parsed.has_avada_keda;
    }
    if (typeof parsed.has_fragment_bundle === "boolean") {
      state.has_fragment_bundle = parsed.has_fragment_bundle;
    }
    if (typeof parsed.has_cave_legendary_fish_level_1_tribute === "boolean") {
      state.has_cave_legendary_fish_level_1_tribute =
        parsed.has_cave_legendary_fish_level_1_tribute;
    }
    if (typeof parsed.has_axolotl_skin_quest === "boolean") {
      state.has_axolotl_skin_quest = parsed.has_axolotl_skin_quest;
    }
    if (typeof parsed.mythic_chests_owned === "number" && parsed.mythic_chests_owned >= 0) {
      state.mythic_chests_owned = Math.floor(parsed.mythic_chests_owned);
    }
    if (typeof parsed.axolotl_skin_quest_level === "number" && parsed.axolotl_skin_quest_level >= 1) {
      state.axolotl_skin_quest_level = Math.floor(parsed.axolotl_skin_quest_level);
    }
    if (typeof parsed.axolotl_skin_quest_rank === "number" && parsed.axolotl_skin_quest_rank >= 0) {
      state.axolotl_skin_quest_level = Math.floor(parsed.axolotl_skin_quest_rank) + 1;
      state.has_axolotl_skin_quest = true;
    }
    if (parsed.abilities && typeof parsed.abilities === "object") {
      if (typeof parsed.abilities.enrage === "boolean") {
        state.abilities.enrage = parsed.abilities.enrage;
      }
      if (typeof parsed.abilities.flurry === "boolean") {
        state.abilities.flurry = parsed.abilities.flurry;
      }
      if (typeof parsed.abilities.quake === "boolean") {
        state.abilities.quake = parsed.abilities.quake;
      }
    }
    if (parsed.stat_levels && typeof parsed.stat_levels === "object") {
      Object.keys(parsed.stat_levels).forEach(function (key) {
        var v = Number(parsed.stat_levels[key]);
        if (Number.isFinite(v) && v >= 0) state.stat_levels[key] = Math.floor(v);
      });
    }
    if (parsed.levels && typeof parsed.levels === "object") {
      Object.keys(parsed.levels).forEach(function (key) {
        var v = Number(parsed.levels[key]);
        if (Number.isFinite(v) && v >= 0) state.levels[key] = Math.floor(v);
      });
    }
    if (parsed.upgrade_levels && typeof parsed.upgrade_levels === "object") {
      Object.keys(parsed.upgrade_levels).forEach(function (tier) {
        var tierObj = parsed.upgrade_levels[tier];
        if (!tierObj || typeof tierObj !== "object") return;
        Object.keys(tierObj).forEach(function (id) {
          var v = Number(tierObj[id]);
          if (Number.isFinite(v) && v >= 0) state.levels[id] = Math.floor(v);
        });
      });
    }
    if (parsed.gem_levels && typeof parsed.gem_levels === "object") {
      Object.keys(parsed.gem_levels).forEach(function (id) {
        var v = Number(parsed.gem_levels[id]);
        if (Number.isFinite(v) && v >= 0) state.levels[id] = Math.floor(v);
      });
    }
    if (parsed.block_cards && typeof parsed.block_cards === "object") {
      state.block_cards = {};
      Object.keys(parsed.block_cards).forEach(function (key) {
        var q = String(parsed.block_cards[key]).toLowerCase();
        if (q === "normal" || q === "gilded" || q === "polychrome") {
          state.block_cards[key] = q;
        }
      });
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "misc_card_quality")) {
      if (parsed.misc_card_quality == null || parsed.misc_card_quality === "") {
        state.misc_card_quality = "";
      } else {
        var mq = String(parsed.misc_card_quality).toLowerCase();
        state.misc_card_quality =
          mq === "normal" || mq === "gilded" || mq === "polychrome" ? mq : "";
      }
    }
  }

  function loadState() {
    initState();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        tryMigrateLegacy();
        return;
      }
      applySnapshot(JSON.parse(raw));
    } catch (err) {
      initState();
    }
  }

  function tryMigrateLegacy() {
    try {
      var raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed.levels || typeof parsed.levels !== "object") return;
      Object.keys(parsed.levels).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(state.levels, id)) return;
        var v = Number(parsed.levels[id]);
        if (Number.isFinite(v) && v >= 0) state.levels[id] = Math.floor(v);
      });
      saveState();
    } catch (e) {
      /* ignore */
    }
  }

  function buildSnapshotForDisk() {
    syncFromDom();
    return {
      _export: "archaeology_calculator_build",
      version: 1,
      saved_at: new Date().toISOString(),
      archaeology_level: state.archaeology_level,
      ascension: state.ascension,
      highest_stage: state.highest_stage,
      has_block_bonker: state.has_block_bonker,
      has_avada_keda: state.has_avada_keda,
      has_fragment_bundle: state.has_fragment_bundle,
      has_cave_legendary_fish_level_1_tribute:
        state.has_cave_legendary_fish_level_1_tribute,
      mythic_chests_owned: state.mythic_chests_owned,
      has_axolotl_skin_quest: state.has_axolotl_skin_quest,
      axolotl_skin_quest_level: state.axolotl_skin_quest_level,
      mc_trials: state.mc_trials,
      custom_trials_enabled: state.custom_trials_enabled,
      abilities: Object.assign({}, state.abilities),
      stat_levels: Object.assign({}, state.stat_levels),
      levels: Object.assign({}, state.levels),
      upgrade_levels: levelsByTier(),
      gem_levels: gemLevels(),
      block_cards: Object.assign({}, state.block_cards),
      misc_card_quality: state.misc_card_quality || "",
    };
  }

  function updateSaveStatus(message) {
    if (!saveStatusEl) saveStatusEl = document.getElementById("build-save-status");
    if (saveStatusEl) saveStatusEl.textContent = message;
    refreshStorageButton();
  }

  function storageConsent() {
    try {
      return localStorage.getItem(STORAGE_CONSENT_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function canPersist() {
    return storageConsent() === "accepted";
  }

  function refreshStorageButton() {
    var btn = document.getElementById("btn-enable-storage");
    if (btn) btn.classList.toggle("hidden", canPersist());
  }

  function setStorageConsent(choice) {
    try {
      localStorage.setItem(STORAGE_CONSENT_KEY, choice);
      refreshStorageButton();
      return true;
    } catch (err) {
      updateSaveStatus("Browser storage is blocked, so this build cannot be saved here.");
      return false;
    }
  }

  function saveState() {
    if (!bootComplete) return;
    syncFromDom();
    if (!canPersist()) {
      updateSaveStatus("Inputs are kept for this tab. Allow browser saving to keep them next time.");
      return false;
    }
    try {
      var payload = buildSnapshotForDisk();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      var when = new Date(payload.saved_at);
      updateSaveStatus(
        "Build auto-saved in this browser at " +
          when.toLocaleTimeString() +
          ". Use Export to keep a copy across machines or folder moves.",
      );
    } catch (err) {
      console.warn("Could not save archaeology build:", err);
      updateSaveStatus("Could not auto-save (storage full or blocked). Export your build to a file.");
      return false;
    }
    return true;
  }

  function readOptimizerResults() {
    try {
      var raw = localStorage.getItem(OPTIMIZER_RESULTS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeOptimizerResults(results) {
    if (!canPersist()) return false;
    try {
      localStorage.setItem(
        OPTIMIZER_RESULTS_KEY,
        JSON.stringify((results || []).slice(0, 24)),
      );
      return true;
    } catch (err) {
      updateSaveStatus("Could not save optimizer results (storage full or blocked).");
      return false;
    }
  }

  function saveOptimizerResult(entry) {
    if (!entry || typeof entry !== "object" || !canPersist()) return false;
    var results = readOptimizerResults();
    results = results.filter(function (r) {
      return r && r.id !== entry.id;
    });
    results.unshift(entry);
    return writeOptimizerResults(results);
  }

  function deleteOptimizerResult(id) {
    var results = readOptimizerResults().filter(function (r) {
      return r && r.id !== id;
    });
    return writeOptimizerResults(results);
  }

  function getOptimizerResult(id) {
    return readOptimizerResults().find(function (r) {
      return r && r.id === id;
    }) || null;
  }

  function exportBuildToFile() {
    var payload = buildSnapshotForDisk();
    var blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "archaeology_build.json";
    a.click();
    URL.revokeObjectURL(url);
    updateSaveStatus("Exported archaeology_build.json — import it anytime to restore.");
  }

  function importBuildFromObject(parsed) {
    initState();
    applySnapshot(parsed);
    syncToDom();
    saveState();
    applyUpgradeLockStates();
    applyBudgetLine();
    document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    updateSaveStatus(
      canPersist()
        ? "Build imported and saved in this browser."
        : "Build imported for this tab. Allow browser saving to keep it next time.",
    );
  }

  function wireImportExport() {
    var exportBtn = document.getElementById("btn-export-build");
    var importBtn = document.getElementById("btn-import-build");
    var fileInput = document.getElementById("import-build-file");
    if (exportBtn && exportBtn.dataset.storeWired !== "1") {
      exportBtn.dataset.storeWired = "1";
      exportBtn.addEventListener("click", exportBuildToFile);
    }
    if (importBtn && fileInput && importBtn.dataset.storeWired !== "1") {
      importBtn.dataset.storeWired = "1";
      importBtn.addEventListener("click", function () {
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            importBuildFromObject(JSON.parse(String(reader.result || "")));
          } catch (e) {
            updateSaveStatus("Import failed: " + e.message);
          }
        };
        reader.readAsText(file);
      });
    }
  }

  function syncCardsFromDomIfReady() {
    if (window.ArchaeologyCardSync && window.ArchaeologyCardSync.fromDom) {
      window.ArchaeologyCardSync.fromDom();
    }
  }

  function syncCardsToDomIfReady() {
    if (window.ArchaeologyCardSync && window.ArchaeologyCardSync.toDom) {
      window.ArchaeologyCardSync.toDom();
    }
  }

  function syncToDom() {
    var el;
    el = document.getElementById("arch-level");
    if (el) el.value = String(state.archaeology_level);
    el = document.getElementById("ascension");
    if (el) el.value = String(state.ascension);
    el = document.getElementById("highest-stage");
    if (el) el.value = String(state.highest_stage);
    el = document.getElementById("mc-trials");
    if (el) el.value = String(state.mc_trials);
    el = document.getElementById("advanced-trials-toggle");
    if (el) el.checked = !!state.custom_trials_enabled;
    el = document.getElementById("bonker");
    if (el) el.checked = !!state.has_block_bonker;
    el = document.getElementById("avada-keda");
    if (el) el.checked = !!state.has_avada_keda;
    el = document.getElementById("fragment-bundle");
    if (el) el.checked = !!state.has_fragment_bundle;
    el = document.getElementById("cave-tribute");
    if (el) el.checked = !!state.has_cave_legendary_fish_level_1_tribute;
    el = document.getElementById("mythic-chests-owned");
    if (el) el.value = String(state.mythic_chests_owned || 0);
    el = document.getElementById("axolotl-quest");
    if (el) el.checked = !!state.has_axolotl_skin_quest;
    el = document.getElementById("axolotl-quest-level");
    if (el) el.value = String(state.axolotl_skin_quest_level || 1);
    el = document.getElementById("ability-enrage");
    if (el) el.checked = state.abilities.enrage !== false;
    el = document.getElementById("ability-flurry");
    if (el) el.checked = state.abilities.flurry !== false;
    el = document.getElementById("ability-quake");
    if (el) el.checked = state.abilities.quake !== false;
    STAT_IDS.forEach(function (id) {
      el = document.getElementById("stat-" + id);
      if (el) el.value = String(state.stat_levels[id] || 0);
    });
    Object.keys(state.levels).forEach(function (id) {
      el = document.getElementById("lvl_" + id);
      if (el) el.value = String(state.levels[id] || 0);
    });
    syncCardsToDomIfReady();
  }

  function syncFromDom() {
    var el = document.getElementById("arch-level");
    if (el) {
      var al = parseInt(el.value, 10);
      state.archaeology_level = Number.isFinite(al) && al >= 1 ? al : 1;
    }
    el = document.getElementById("ascension");
    if (el) {
      var asc = parseInt(el.value, 10);
      state.ascension = Number.isFinite(asc) && asc >= 0 ? asc : 0;
    }
    el = document.getElementById("highest-stage");
    if (el) {
      var hs = parseInt(el.value, 10);
      state.highest_stage = Number.isFinite(hs) && hs >= 1 ? hs : 1;
    }
    el = document.getElementById("mc-trials");
    if (el) {
      var mc = parseInt(el.value, 10);
      state.mc_trials = Number.isFinite(mc) && mc >= 1 ? mc : 600;
    }
    el = document.getElementById("advanced-trials-toggle");
    if (el) state.custom_trials_enabled = !!el.checked;
    el = document.getElementById("bonker");
    if (el) state.has_block_bonker = !!el.checked;
    el = document.getElementById("avada-keda");
    if (el) state.has_avada_keda = !!el.checked;
    el = document.getElementById("fragment-bundle");
    if (el) state.has_fragment_bundle = !!el.checked;
    el = document.getElementById("cave-tribute");
    if (el) state.has_cave_legendary_fish_level_1_tribute = !!el.checked;
    el = document.getElementById("mythic-chests-owned");
    if (el) {
      var chests = parseInt(el.value, 10);
      state.mythic_chests_owned = Number.isFinite(chests) && chests >= 0 ? chests : 0;
    }
    el = document.getElementById("axolotl-quest");
    if (el) state.has_axolotl_skin_quest = !!el.checked;
    el = document.getElementById("axolotl-quest-level");
    if (el) {
      var axo = parseInt(el.value, 10);
      state.axolotl_skin_quest_level = Number.isFinite(axo) && axo >= 1 ? axo : 1;
    }
    el = document.getElementById("ability-enrage");
    if (el) state.abilities.enrage = !!el.checked;
    el = document.getElementById("ability-flurry");
    if (el) state.abilities.flurry = !!el.checked;
    el = document.getElementById("ability-quake");
    if (el) state.abilities.quake = !!el.checked;
    STAT_IDS.forEach(function (id) {
      el = document.getElementById("stat-" + id);
      if (!el || el.dataset.storeWired !== "1") return;
      var v = parseInt(el.value, 10);
      state.stat_levels[id] = Number.isFinite(v) && v >= 0 ? v : 0;
    });
    document.querySelectorAll(".upgrade[data-upgrade-id]").forEach(function (row) {
      var id = row.getAttribute("data-upgrade-id");
      if (!id) return;
      if (!Object.prototype.hasOwnProperty.call(state.levels, id)) state.levels[id] = 0;
      el = document.getElementById("lvl_" + id);
      if (!el || el.dataset.storeWired !== "1") return;
      var lv = parseInt(el.value, 10);
      state.levels[id] = Number.isFinite(lv) && lv >= 0 ? lv : 0;
    });
    syncCardsFromDomIfReady();
  }

  function parseInputLevel(input) {
    var raw = input.value.trim();
    if (raw === "") return 0;
    var parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }

  function wireNumericInput(input, applyToState) {
    if (!input || input.dataset.storeWired === "1") return;
    input.dataset.storeWired = "1";

    input.addEventListener("mousedown", function (e) {
      if (input.disabled || input.readOnly) return;
      if (document.activeElement !== input) {
        e.preventDefault();
        input.focus({ preventScroll: true });
      }
    });

    input.addEventListener("focus", function () {
      if (input.disabled) return;
      input.select();
    });

    input.addEventListener("input", function () {
      applyToState(parseInputLevel(input));
      saveState();
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    });

    input.addEventListener("blur", function () {
      if (input.value.trim() === "") input.value = "0";
      applyToState(parseInputLevel(input));
      saveState();
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    });
  }

  function wireScalar(id, stateKey) {
    var input = document.getElementById(id);
    if (!input) return;
    wireNumericInput(input, function (v) {
      state[stateKey] = v;
      if (stateKey === "highest_stage") applyUpgradeLockStates();
      if (stateKey === "archaeology_level") applyBudgetLine();
    });
  }

  function wireUpgradeInputs() {
    document.querySelectorAll(".upgrade[data-upgrade-id]").forEach(function (row) {
      var id = row.getAttribute("data-upgrade-id");
      if (!id) return;
      if (!Object.prototype.hasOwnProperty.call(state.levels, id)) state.levels[id] = 0;
      var input = document.getElementById("lvl_" + id);
      if (!input) return;
      wireNumericInput(input, function (v) {
        state.levels[id] = v;
      });
    });
  }

  function wireStatInputs() {
    STAT_IDS.forEach(function (id) {
      var input = document.getElementById("stat-" + id);
      if (!input) return;
      if (!Object.prototype.hasOwnProperty.call(state.stat_levels, id)) state.stat_levels[id] = 0;
      wireNumericInput(input, function (v) {
        state.stat_levels[id] = v;
        applyBudgetLine();
      });
    });
  }

  function wireBonker() {
    var bonker = document.getElementById("bonker");
    if (!bonker || bonker.dataset.storeWired === "1") return;
    bonker.dataset.storeWired = "1";
    bonker.addEventListener("change", function () {
      state.has_block_bonker = !!bonker.checked;
      saveState();
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    });
  }

  function wireCheckbox(id, stateKey) {
    var box = document.getElementById(id);
    if (!box || box.dataset.storeWired === "1") return;
    box.dataset.storeWired = "1";
    box.addEventListener("change", function () {
      state[stateKey] = !!box.checked;
      saveState();
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    });
  }

  function wireExternalUnlocks() {
    wireCheckbox("avada-keda", "has_avada_keda");
    wireCheckbox("fragment-bundle", "has_fragment_bundle");
    wireCheckbox(
      "cave-tribute",
      "has_cave_legendary_fish_level_1_tribute",
    );
    wireCheckbox("axolotl-quest", "has_axolotl_skin_quest");
    var chests = document.getElementById("mythic-chests-owned");
    wireNumericInput(chests, function (v) {
      state.mythic_chests_owned = v;
    });
    var axo = document.getElementById("axolotl-quest-level");
    wireNumericInput(axo, function (v) {
      state.axolotl_skin_quest_level = Math.max(1, v || 1);
    });
  }

  function wireAbility(id, key) {
    var box = document.getElementById(id);
    if (!box || box.dataset.storeWired === "1") return;
    box.dataset.storeWired = "1";
    box.addEventListener("change", function () {
      state.abilities[key] = !!box.checked;
      saveState();
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    });
  }

  function wireAbilities() {
    wireAbility("ability-enrage", "enrage");
    wireAbility("ability-flurry", "flurry");
    wireAbility("ability-quake", "quake");
  }

  function wireTrialToggle() {
    var box = document.getElementById("advanced-trials-toggle");
    if (!box || box.dataset.storeWired === "1") return;
    box.dataset.storeWired = "1";
    box.addEventListener("change", function () {
      state.custom_trials_enabled = !!box.checked;
      saveState();
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    });
  }

  function hideStorageConsent() {
    var prompt = document.getElementById("storage-consent");
    if (prompt) prompt.classList.add("hidden");
  }

  function showStorageConsentIfNeeded() {
    var prompt = document.getElementById("storage-consent");
    if (!prompt || storageConsent()) return;
    prompt.classList.remove("hidden");
  }

  function wireStorageConsent() {
    var accept = document.getElementById("btn-storage-accept");
    var decline = document.getElementById("btn-storage-decline");
    var enable = document.getElementById("btn-enable-storage");
    var acceptStorage = function () {
      if (setStorageConsent("accepted")) {
        hideStorageConsent();
        saveState();
        document.dispatchEvent(new CustomEvent("archaeology-build-change"));
      }
    };
    if (accept && accept.dataset.storeWired !== "1") {
      accept.dataset.storeWired = "1";
      accept.addEventListener("click", acceptStorage);
    }
    if (decline && decline.dataset.storeWired !== "1") {
      decline.dataset.storeWired = "1";
      decline.addEventListener("click", function () {
        setStorageConsent("declined");
        hideStorageConsent();
        updateSaveStatus("Inputs are not saved on this browser. Use Export if you want a copy.");
      });
    }
    if (enable && enable.dataset.storeWired !== "1") {
      enable.dataset.storeWired = "1";
      enable.addEventListener("click", acceptStorage);
    }
  }

  function wireAll() {
    wireScalar("arch-level", "archaeology_level");
    wireScalar("ascension", "ascension");
    wireScalar("highest-stage", "highest_stage");
    wireScalar("mc-trials", "mc_trials");
    wireTrialToggle();
    wireBonker();
    wireExternalUnlocks();
    wireAbilities();
    wireUpgradeInputs();
    wireStatInputs();
    wireImportExport();
  }

  function boot() {
    loadState();
    syncToDom();
    wireAll();
    bindLockListeners();
    applyUpgradeLockStates();
    applyBudgetLine();
    bootComplete = true;
    wireStorageConsent();
    if (canPersist()) {
      saveState();
    } else {
      updateSaveStatus("Inputs are kept for this tab. Allow browser saving to keep them next time.");
      showStorageConsentIfNeeded();
    }
    setTimeout(function () {
      document.dispatchEvent(new CustomEvent("archaeology-build-change"));
    }, 0);
  }

  window.ArchaeologyStore = {
    STORAGE_KEY: STORAGE_KEY,
    STAT_IDS: STAT_IDS,
    state: state,
    loadState: loadState,
    saveState: saveState,
    syncToDom: syncToDom,
    syncFromDom: syncFromDom,
    wireNumericInput: wireNumericInput,
    wireStatInputs: wireStatInputs,
    wireUpgradeInputs: wireUpgradeInputs,
    wireAll: wireAll,
    boot: boot,
    applyUpgradeLocks: applyUpgradeLockStates,
    applyBudgetLine: applyBudgetLine,
    getSnapshot: function () {
      syncFromDom();
      return {
        archaeology_level: state.archaeology_level,
        ascension: state.ascension,
        highest_stage: state.highest_stage,
        has_block_bonker: state.has_block_bonker,
        has_avada_keda: state.has_avada_keda,
        has_fragment_bundle: state.has_fragment_bundle,
        has_cave_legendary_fish_level_1_tribute:
          state.has_cave_legendary_fish_level_1_tribute,
        mythic_chests_owned: state.mythic_chests_owned,
        has_axolotl_skin_quest: state.has_axolotl_skin_quest,
        axolotl_skin_quest_level: state.axolotl_skin_quest_level,
        mc_trials: state.mc_trials,
        custom_trials_enabled: state.custom_trials_enabled,
        abilities: Object.assign({}, state.abilities),
        stat_levels: Object.assign({}, state.stat_levels),
        levels: Object.assign({}, state.levels),
        upgrade_levels: levelsByTier(),
        gem_levels: gemLevels(),
        block_cards: Object.assign({}, state.block_cards),
        misc_card_quality: state.misc_card_quality || "",
      };
    },
    exportBuildToFile: exportBuildToFile,
    importBuildFromObject: importBuildFromObject,
    applySnapshot: applySnapshot,
    canPersist: canPersist,
    storageConsent: storageConsent,
    saveOptimizerResult: saveOptimizerResult,
    readOptimizerResults: readOptimizerResults,
    deleteOptimizerResult: deleteOptimizerResult,
    getOptimizerResult: getOptimizerResult,
  };

  function levelsByTier() {
    var out = { common: {}, rare: {}, epic: {}, legendary: {}, mythic: {} };
    document.querySelectorAll(".upgrade[data-upgrade-id]").forEach(function (row) {
      var id = row.getAttribute("data-upgrade-id");
      var tier = row.getAttribute("data-tier");
      if (tier === "gem" || !out[tier]) return;
      out[tier][id] = state.levels[id] || 0;
    });
    return out;
  }

  function gemLevels() {
    var gem = {};
    document.querySelectorAll('.upgrade[data-tier="gem"][data-upgrade-id]').forEach(function (row) {
      var id = row.getAttribute("data-upgrade-id");
      gem[id] = state.levels[id] || 0;
    });
    return gem;
  }

  window.addEventListener("beforeunload", saveState);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") saveState();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
