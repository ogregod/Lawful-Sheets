/**
 * Lawful Sheets - Settings Registration
 * Defines all lock categories, registers settings, and exports the isLocked helper.
 */

// Define locally to avoid circular import with module.mjs
const MODULE_ID = "lawful-sheets";

/**
 * Subcategories for the Inventory lock category.
 * Each can be configured independently or set to "inherit" from the parent.
 */
export const INVENTORY_SUBCATEGORIES = {
    addItems:   { key: "lockInventoryAdd",      name: "Add Items" },
    deleteItems:{ key: "lockInventoryDelete",   name: "Delete Items" },
    equip:      { key: "lockInventoryEquip",    name: "Equip / Unequip" },
    prepared:   { key: "lockInventoryPrepared", name: "Prepared State" },
    quantity:   { key: "lockInventoryQuantity", name: "Increase Quantity" }
};

/**
 * All lock categories with their setting keys, display names, and group.
 * Order determines display order in module settings and the Lawful Manager.
 *
 * Groups: "character" | "resources" | "inventory" | "ui"
 */
export const LOCK_CATEGORIES = {
    // ── Character Stats ──────────────────────────────────────────
    hp:           { key: "lockHp",           name: "HP & Hit Dice",    group: "character" },
    abilities:    { key: "lockAbilities",    name: "Ability Scores",   group: "character" },
    deathSaves:   { key: "lockDeathSaves",   name: "Death Saves",      group: "character" },

    // ── Resources ────────────────────────────────────────────────
    currency:     { key: "lockCurrency",     name: "Currency",         group: "resources" },
    spellSlots:   { key: "lockSpellSlots",   name: "Spell Slots",      group: "resources" },
    xp:           { key: "lockXp",           name: "Experience Points", group: "resources" },

    // ── Inventory ────────────────────────────────────────────────
    inventory:    { key: "lockInventory",    name: "Inventory",        group: "inventory", subcategories: INVENTORY_SUBCATEGORIES },

    // ── Sheet UI ─────────────────────────────────────────────────
    tokenHud:     { key: "lockTokenHud",     name: "Token HUD",        group: "ui" },
    editMode:     { key: "lockEditMode",     name: "Edit Mode",        group: "ui" },
    contextMenu:  { key: "lockContextMenu",  name: "Context Menus",    group: "ui" },
    refundButton: { key: "lockRefundButton", name: "Refund Button",    group: "ui" }
};

/** Choices for top-level category settings */
const CATEGORY_CHOICES = {
    "none":    "Everyone Unlocked",
    "player":  "Players Locked (Trusted Free)",
    "all":     "Everyone Locked",
    "request": "Request GM Approval"
};

/** Choices for inventory subcategory settings */
const SUBCATEGORY_CHOICES = {
    "inherit": "Inherit from Inventory",
    "none":    "Everyone Unlocked",
    "player":  "Players Locked (Trusted Free)",
    "all":     "Everyone Locked",
    "request": "Request GM Approval"
};

/**
 * Register all module settings. Called during the init hook.
 */
export function registerSettings() {
    // Hidden setting: per-user overrides object
    game.settings.register(MODULE_ID, "userOverrides", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    // Register a global setting for each lock category
    for (const [, cat] of Object.entries(LOCK_CATEGORIES)) {
        game.settings.register(MODULE_ID, cat.key, {
            name: `Global: ${cat.name}`,
            hint: `Default lock behavior for ${cat.name}. Override per-user via Token Controls > Gavel button.`,
            scope: "world",
            config: true,
            type: String,
            choices: CATEGORY_CHOICES,
            default: "player",
            requiresReload: true
        });
    }

    // Register inventory subcategory settings
    for (const [, sub] of Object.entries(INVENTORY_SUBCATEGORIES)) {
        game.settings.register(MODULE_ID, sub.key, {
            name: `Inventory: ${sub.name}`,
            hint: `Lock behavior for ${sub.name}. "Inherit" follows the main Inventory setting.`,
            scope: "world",
            config: true,
            type: String,
            choices: SUBCATEGORY_CHOICES,
            default: "inherit",
            requiresReload: true
        });
    }

    // Cheat detection logging toggle
    game.settings.register(MODULE_ID, "cheatLogging", {
        name: "Cheat Detection Logging",
        hint: "When enabled, whispers a message to the GM when a player's unauthorized change is blocked.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    // Module whitelist for bypass
    game.settings.register(MODULE_ID, "moduleWhitelist", {
        name: "Module Whitelist",
        hint: "Comma-separated module IDs whose changes bypass validation (e.g. 'item-piles'). GM-initiated changes always pass.",
        scope: "world",
        config: true,
        type: String,
        default: "item-piles"
    });
}

/* ============================================================ */
/* LOCK LEVEL RESOLUTION                                        */
/* ============================================================ */

/**
 * Resolve a raw setting value + user into a lock level string.
 * @param {string} setting - "none" | "player" | "all" | "request"
 * @param {User} user
 * @returns {"none"|"locked"|"request"}
 */
function resolveLevel(setting, user) {
    if (setting === "all")     return "locked";
    if (setting === "request") return "request";
    if (setting === "player" && !user.hasRole("TRUSTED")) return "locked";
    return "none";
}

/**
 * Get the effective lock level for a category (and optional subcategory) for a user.
 * Priority: per-user override > subcategory global > parent category global.
 * GMs always return "none".
 *
 * @param {string} categoryId - Key from LOCK_CATEGORIES (e.g. "inventory")
 * @param {string} userId - The user ID to check
 * @param {string|null} subId - Optional subcategory key (e.g. "equip")
 * @returns {"none"|"locked"|"request"}
 */
export function getLockLevel(categoryId, userId, subId = null) {
    const user = game.users.get(userId);
    if (!user || user.role >= 3) return "none";

    const overrides = game.settings.get(MODULE_ID, "userOverrides") || {};
    const overrideKey = subId ? `${categoryId}.${subId}` : categoryId;
    const userOverride = overrides[userId]?.[overrideKey];

    if (userOverride === "force-lock")    return "locked";
    if (userOverride === "force-unlock")  return "none";
    if (userOverride === "force-request") return "request";

    // Subcategory global setting (if subId given and not "inherit")
    if (subId) {
        const subCat = LOCK_CATEGORIES[categoryId]?.subcategories?.[subId];
        if (subCat) {
            const subGlobal = game.settings.get(MODULE_ID, subCat.key);
            if (subGlobal !== "inherit") {
                return resolveLevel(subGlobal, user);
            }
        }
    }

    // Parent category global setting
    const cat = LOCK_CATEGORIES[categoryId];
    if (!cat) return "none";
    const globalSetting = game.settings.get(MODULE_ID, cat.key);
    return resolveLevel(globalSetting, user);
}

/**
 * Returns true if the category is hard-locked for the user.
 * @param {string} categoryId
 * @param {string} userId
 * @param {string|null} subId
 * @returns {boolean}
 */
export function isLocked(categoryId, userId, subId = null) {
    return getLockLevel(categoryId, userId, subId) === "locked";
}

/**
 * Returns true if the category requires GM approval for the user.
 * @param {string} categoryId
 * @param {string} userId
 * @param {string|null} subId
 * @returns {boolean}
 */
export function isRequest(categoryId, userId, subId = null) {
    return getLockLevel(categoryId, userId, subId) === "request";
}
