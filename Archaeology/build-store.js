/**
 * In-memory build state + localStorage (same pattern as Event Calculator).
 * Classic script — no ES modules — so it always runs before/with the page.
 */
(function () {
  var STORAGE_KEY = "archaeology_calculator_build_v1";
  var LEGACY_KEY = "archaeology_push_calculator_v1";

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
    mc_trials: 600,
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
    state.mc_trials = 600;
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
    if (typeof parsed.has_block_bonker === "boolean") {
      state.has_block_bonker = parsed.has_block_bonker;
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
      mc_trials: state.mc_trials,
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
  }

  function saveState() {
    if (!bootComplete) return;
    syncFromDom();
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
    }
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
    updateSaveStatus("Build imported and saved in this browser.");
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
    el = document.getElementById("bonker");
    if (el) el.checked = !!state.has_block_bonker;
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
    el = document.getElementById("bonker");
    if (el) state.has_block_bonker = !!el.checked;
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

  function wireAll() {
    wireScalar("arch-level", "archaeology_level");
    wireScalar("ascension", "ascension");
    wireScalar("highest-stage", "highest_stage");
    wireScalar("mc-trials", "mc_trials");
    wireBonker();
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
    saveState();
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
        mc_trials: state.mc_trials,
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
