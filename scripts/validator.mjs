/**
 * Lawful Sheets - Backend Validator
 * Hooks into preUpdateActor, preUpdateItem, preCreateItem, and preDeleteItem
 * to reject unauthorized data changes server-side.
 *
 * This is the REAL security layer. CSS enforcement (enforcer.mjs) is just UX.
 */

import { isLocked } from "./settings.mjs";

const MODULE_ID = "lawful-sheets";

/* ============================================================ */
/* PATH-TO-CATEGORY MAPPING                                     */
/* ============================================================ */

/**
 * Maps data paths to lock categories for actor updates.
 * Each entry: { pattern: RegExp, category: string }
 */
const ACTOR_PATH_MAP = [
    // HP & Hit Dice
    { pattern: /^system\.attributes\.hp\./,  category: "hp" },
    { pattern: /^system\.attributes\.hd\./,  category: "hp" },
    { pattern: /^system\.attributes\.hd$/,   category: "hp" },

    // Ability Scores
    { pattern: /^system\.abilities\.\w+\.value$/, category: "abilities" },

    // Currency
    { pattern: /^system\.currency\./,  category: "currency" },
    { pattern: /^system\.currency$/,   category: "currency" },

    // Spell Slots
    { pattern: /^system\.spells\./,  category: "spellSlots" },
    { pattern: /^system\.spells$/,   category: "spellSlots" },

    // Experience Points
    { pattern: /^system\.details\.xp\./, category: "xp" },
    { pattern: /^system\.details\.xp$/,  category: "xp" },

    // Death Saves
    { pattern: /^system\.attributes\.death\./, category: "deathSaves" },
    { pattern: /^system\.attributes\.death$/,  category: "deathSaves" }
];

/**
 * Paths on embedded items that are protected by the inventory lock.
 */
const INVENTORY_ITEM_PATHS = [
    /^system\.quantity$/,
    /^system\.uses\./,
    /^system\.uses$/,
    /^system\.equipped$/,
    /^system\.preparation\.prepared$/,
    /^system\.preparation$/
];

/**
 * Paths on class-type items protected by the HP lock (hit dice).
 */
const HIT_DICE_ITEM_PATHS = [
    /^system\.hitDiceUsed$/,
    /^system\.hitDice/
];

/* ============================================================ */
/* UTILITY FUNCTIONS                                            */
/* ============================================================ */

/**
 * Delete a dot-notation path from a nested object.
 * Cleans up empty parent containers afterward.
 *
 * @param {Object} obj - The object to modify
 * @param {string} path - Dot-notation path (e.g. "system.currency.gp")
 */
function deletePath(obj, path) {
    const parts = path.split(".");
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        current = current?.[parts[i]];
        if (current === undefined) return;
    }

    delete current?.[parts[parts.length - 1]];

    // Clean up empty parent objects (walk backwards)
    for (let i = parts.length - 2; i >= 0; i--) {
        let parent = obj;
        for (let j = 0; j < i; j++) parent = parent[parts[j]];
        const child = parent[parts[i]];
        if (child && typeof child === "object" && Object.keys(child).length === 0) {
            delete parent[parts[i]];
        } else {
            break;
        }
    }
}

/**
 * Check if the update comes from a whitelisted module.
 * @param {Object} options - The update options object
 * @returns {boolean}
 */
function isWhitelistedSource(options) {
    const raw = game.settings.get(MODULE_ID, "moduleWhitelist");
    const whitelist = raw.split(",").map(s => s.trim()).filter(Boolean);

    for (const moduleId of whitelist) {
        // Modules often pass their ID as a truthy key in options
        if (options[moduleId]) return true;
        // Or nested under flags
        if (options?.flags?.[moduleId]) return true;
    }

    // dnd5e internal operations (rests, damage application, healing, etc.)
    if (options.isRest) return true;
    if (options.isDamage) return true;
    if (options.isHealing) return true;

    // dnd5e activity-based updates (using items, casting spells)
    if (options.isActivity) return true;

    return false;
}

/**
 * Log a blocked cheat attempt by whispering the GM.
 * Only the GM client creates the message to avoid duplicates.
 *
 * @param {User} user - The user who attempted the change
 * @param {Actor|Item} document - The document being changed
 * @param {string} field - The data path that was blocked
 * @param {*} oldValue - The original value
 * @param {*} newValue - The attempted new value
 */
function logCheatAttempt(user, document, field, oldValue, newValue) {
    if (!game.settings.get(MODULE_ID, "cheatLogging")) return;

    // Only the GM client should create the whisper to prevent duplicates
    if (!game.user.isGM) return;

    const actorName = document instanceof Actor ? document.name : document.parent?.name ?? "Unknown";
    const gmIds = game.users.filter(u => u.isGM && u.active).map(u => u.id);

    ChatMessage.create({
        content: `<div style="border-left: 3px solid #ff4444; padding: 5px 10px; background: rgba(255,68,68,0.1); border-radius: 3px;">
            <strong style="color: #ff4444;">&#9888; Lawful Sheets Alert</strong><br>
            <b>${user.name}</b> attempted to modify <code>${field}</code> on <b>${actorName}</b><br>
            <small>Old: <code>${oldValue}</code> &rarr; Attempted: <code>${newValue}</code></small>
        </div>`,
        whisper: gmIds,
        speaker: { alias: "Lawful Sheets" }
    });
}

/* ============================================================ */
/* PRE-UPDATE ACTOR HOOK                                        */
/* ============================================================ */

/**
 * Intercepts actor updates. Flattens the changes object, checks each
 * path against the category map, and strips unauthorized fields.
 * If ALL meaningful fields are stripped, blocks the entire update.
 */
function onPreUpdateActor(actor, changes, options, userId) {
    const user = game.users.get(userId);
    if (!user) return;

    // GMs always pass
    if (user.role >= 3) return;

    // Whitelisted module operations pass
    if (isWhitelistedSource(options)) return;

    const flat = foundry.utils.flattenObject(changes);
    let blocked = false;

    for (const [path, newValue] of Object.entries(flat)) {
        if (path === "_id") continue;

        for (const mapping of ACTOR_PATH_MAP) {
            if (mapping.pattern.test(path) && isLocked(mapping.category, userId)) {
                const oldValue = foundry.utils.getProperty(actor, path);
                logCheatAttempt(user, actor, path, oldValue, newValue);
                deletePath(changes, path);
                blocked = true;
                break;
            }
        }
    }

    // If we stripped everything meaningful, cancel the entire update
    if (blocked) {
        const remaining = foundry.utils.flattenObject(changes);
        const meaningfulKeys = Object.keys(remaining).filter(k => k !== "_id");
        if (meaningfulKeys.length === 0) {
            return false;
        }
    }
}

/* ============================================================ */
/* PRE-UPDATE ITEM HOOK                                         */
/* ============================================================ */

/**
 * Intercepts embedded item updates (items on actors).
 * Checks inventory-locked paths and hit-dice paths on class items.
 */
function onPreUpdateItem(item, changes, options, userId) {
    // Only care about items embedded on actors
    if (!item.parent || !(item.parent instanceof Actor)) return;

    const user = game.users.get(userId);
    if (!user || user.role >= 3) return;
    if (isWhitelistedSource(options)) return;

    const flat = foundry.utils.flattenObject(changes);
    let blocked = false;

    for (const [path, newValue] of Object.entries(flat)) {
        if (path === "_id") continue;

        // Check inventory-locked paths
        if (isLocked("inventory", userId)) {
            for (const pattern of INVENTORY_ITEM_PATHS) {
                if (pattern.test(path)) {
                    const oldValue = foundry.utils.getProperty(item, path);
                    logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                    deletePath(changes, path);
                    blocked = true;
                    break;
                }
            }
        }

        // Check hit dice paths on class-type items (protected by HP lock)
        if (item.type === "class" && isLocked("hp", userId)) {
            for (const pattern of HIT_DICE_ITEM_PATHS) {
                if (pattern.test(path)) {
                    const oldValue = foundry.utils.getProperty(item, path);
                    logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                    deletePath(changes, path);
                    blocked = true;
                    break;
                }
            }
        }
    }

    if (blocked) {
        const remaining = foundry.utils.flattenObject(changes);
        const meaningfulKeys = Object.keys(remaining).filter(k => k !== "_id");
        if (meaningfulKeys.length === 0) {
            return false;
        }
    }
}

/* ============================================================ */
/* PRE-CREATE ITEM HOOK                                         */
/* ============================================================ */

/**
 * Blocks item creation on actors when inventory is locked.
 */
function onPreCreateItem(item, data, options, userId) {
    if (!item.parent || !(item.parent instanceof Actor)) return;

    const user = game.users.get(userId);
    if (!user || user.role >= 3) return;
    if (isWhitelistedSource(options)) return;

    if (isLocked("inventory", userId)) {
        logCheatAttempt(user, item.parent, `Create item: ${data.name || "unknown"}`, "N/A", "new item");
        return false;
    }
}

/* ============================================================ */
/* PRE-DELETE ITEM HOOK                                         */
/* ============================================================ */

/**
 * Blocks item deletion on actors when inventory is locked.
 */
function onPreDeleteItem(item, options, userId) {
    if (!item.parent || !(item.parent instanceof Actor)) return;

    const user = game.users.get(userId);
    if (!user || user.role >= 3) return;
    if (isWhitelistedSource(options)) return;

    if (isLocked("inventory", userId)) {
        logCheatAttempt(user, item.parent, `Delete item: ${item.name}`, item.name, "deleted");
        return false;
    }
}

/* ============================================================ */
/* REGISTRATION                                                 */
/* ============================================================ */

/**
 * Register all validation hooks. Called during the ready hook.
 */
export function registerValidationHooks() {
    Hooks.on("preUpdateActor", onPreUpdateActor);
    Hooks.on("preUpdateItem", onPreUpdateItem);
    Hooks.on("preCreateItem", onPreCreateItem);
    Hooks.on("preDeleteItem", onPreDeleteItem);
    console.log("Lawful Sheets | Backend validation hooks registered.");
}
