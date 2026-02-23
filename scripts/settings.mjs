/**
 * Lawful Sheets - Settings Registration
 * Defines all lock categories, registers settings, and exports the isLocked helper.
 */

// Define locally to avoid circular import with module.mjs
const MODULE_ID = "lawful-sheets";

/**
 * All lock categories with their setting keys and display names.
 * Each category gets a global setting (none/player/all) and per-user overrides.
 */
export const LOCK_CATEGORIES = {
    editMode:     { key: "lockEditMode",     name: "Edit Mode" },
    contextMenu:  { key: "lockContextMenu",  name: "Context Menus" },
    hp:           { key: "lockHp",           name: "HP & Hit Dice" },
    abilities:    { key: "lockAbilities",    name: "Ability Scores" },
    currency:     { key: "lockCurrency",     name: "Currency" },
    inventory:    { key: "lockInventory",    name: "Inventory" },
    spellSlots:   { key: "lockSpellSlots",   name: "Spell Slots" },
    xp:           { key: "lockXp",           name: "Experience Points" },
    deathSaves:   { key: "lockDeathSaves",   name: "Death Saves" },
    tokenHud:     { key: "lockTokenHud",     name: "Token HUD" },
    refundButton: { key: "lockRefundButton", name: "Refund Button" }
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
            choices: {
                "none":   "Everyone Unlocked",
                "player": "Players Locked (Trusted Free)",
                "all":    "Everyone Locked"
            },
            default: "player",
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

/**
 * Determine if a lock category is active for a given user.
 * Priority: per-user override > global setting > default unlocked.
 * GMs (role >= 3) always return false.
 *
 * @param {string} categoryId - Key from LOCK_CATEGORIES (e.g. "currency")
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if the category is locked for this user
 */
export function isLocked(categoryId, userId) {
    const user = game.users.get(userId);
    if (!user || user.role >= 3) return false;

    const cat = LOCK_CATEGORIES[categoryId];
    if (!cat) return false;

    // Check per-user override first
    const overrides = game.settings.get(MODULE_ID, "userOverrides") || {};
    const userOverride = overrides[userId]?.[categoryId];

    if (userOverride === "force-lock") return true;
    if (userOverride === "force-unlock") return false;

    // Fall back to global setting
    const globalSetting = game.settings.get(MODULE_ID, cat.key);
    if (globalSetting === "all") return true;
    if (globalSetting === "player" && !user.hasRole("TRUSTED")) return true;

    return false;
}
