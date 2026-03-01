/**
 * Lawful Sheets - Validator
 * Hooks into preUpdateActor, preUpdateItem, preCreateItem, and preDeleteItem
 * to reject or escalate unauthorized data changes on the client.
 */

import { isLocked, isRequest, getLockLevel } from "./settings.mjs";

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
 * Spell slot / spell point VALUE paths where decreases are allowed (consumption).
 * Increases are still blocked when spellSlots is locked.
 */
const SPELL_NUMERIC_PATHS = [
    /^system\.spells\.\w+\.value$/   // e.g. spell1.value, spell2.value, points.value
];

/**
 * Paths on embedded items where INCREASES are blocked (cheating),
 * but DECREASES are allowed (legitimate item usage / consumption).
 * Routed through the "quantity" subcategory.
 */
const INVENTORY_NUMERIC_PATHS = [
    /^system\.quantity$/,
    /^system\.uses\.value$/
];

/**
 * Paths on embedded items that are fully locked under a specific subcategory.
 * system.equipped → "equip" subcategory
 * system.preparation.* → "prepared" subcategory
 * system.uses.max → "quantity" subcategory (no subtraction logic applies)
 */
const INVENTORY_SUBCATEGORY_PATHS = [
    { pattern: /^system\.equipped$/,              subId: "equip" },
    { pattern: /^system\.preparation\.prepared$/, subId: "prepared" },
    { pattern: /^system\.preparation$/,           subId: "prepared" },
    { pattern: /^system\.uses\.max$/,             subId: "quantity" }
];

/**
 * Currency paths on container-type items (bags, backpacks, etc.).
 * INCREASES are blocked (cheating), DECREASES are allowed (spending).
 */
const CONTAINER_CURRENCY_PATHS = [
    /^system\.currency\.cp$/,
    /^system\.currency\.sp$/,
    /^system\.currency\.ep$/,
    /^system\.currency\.gp$/,
    /^system\.currency\.pp$/,
    /^system\.currency$/
];

/**
 * Paths on class-type items protected by the HP lock (hit dice).
 */
const HIT_DICE_ITEM_PATHS = [
    /^system\.hitDiceUsed$/,
    /^system\.hitDice/
];

/* ============================================================ */
/* PENDING APPROVAL REQUESTS                                    */
/* ============================================================ */

/**
 * In-memory store for pending approval requests on this client.
 * Keyed by requestId. Primarily used for reference; the authoritative
 * data for cross-client approval is stored in the chat message flags.
 */
export const pendingRequests = new Map();

/* ============================================================ */
/* UTILITY FUNCTIONS                                            */
/* ============================================================ */

/**
 * Delete a dot-notation path from a nested object.
 * Cleans up empty parent containers afterward.
 */
function deletePath(obj, path) {
    const parts = path.split(".");
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        current = current?.[parts[i]];
        if (current === undefined) return;
    }

    delete current?.[parts[parts.length - 1]];

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
 * Check if the update comes from a whitelisted module or an approved action.
 * @param {Object} options - The update options object
 * @returns {boolean}
 */
function isWhitelistedSource(options) {
    // GM-approved action (from our own approval flow)
    if (options.lawfulApproved) return true;

    const raw = game.settings.get(MODULE_ID, "moduleWhitelist");
    const whitelist = raw.split(",").map(s => s.trim()).filter(Boolean);

    for (const moduleId of whitelist) {
        if (options[moduleId]) return true;
        if (options?.flags?.[moduleId]) return true;
    }

    // Item Piles variants
    if (options.itemPiles)     return true;
    if (options.fromItemPiles) return true;

    // dnd5e internal operations
    if (options.isRest)     return true;
    if (options.isDamage)   return true;
    if (options.isHealing)  return true;
    if (options.isActivity) return true;

    return false;
}

/**
 * Log a blocked cheat attempt by whispering all active GMs.
 */
function logCheatAttempt(user, document, field, oldValue, newValue) {
    if (!game.settings.get(MODULE_ID, "cheatLogging")) return;

    const actorName = document instanceof Actor ? document.name : document.parent?.name ?? "Unknown";
    const gmIds = game.users.filter(u => u.isGM && u.active).map(u => u.id);
    if (gmIds.length === 0) return;

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

/**
 * Send a GM approval request as a whispered chat card with Approve/Deny buttons.
 * The full request data is embedded in the chat message flags so the GM can
 * approve from any client without needing local state.
 *
 * @param {User} user - The player making the request
 * @param {Actor|null} actor - The actor being modified
 * @param {string} label - Human-readable description of the action
 * @param {Object} requestData - Data needed to replay the action on approval
 */
function sendApprovalRequest(user, actor, label, requestData) {
    const requestId = foundry.utils.randomID();
    pendingRequests.set(requestId, requestData);

    const gmIds = game.users.filter(u => u.isGM && u.active).map(u => u.id);
    if (gmIds.length === 0) return; // No GM online — silently blocked

    const actorName = actor?.name ?? "Unknown";

    ChatMessage.create({
        flags: {
            [MODULE_ID]: {
                approvalRequest: true,
                requestId,
                requestData
            }
        },
        content: `<div style="border-left: 3px solid #f0a500; padding: 5px 10px; background: rgba(240,165,0,0.1); border-radius: 3px;">
            <strong style="color: #f0a500;">&#9889; Lawful Sheets &mdash; Approval Request</strong><br>
            <b>${user.name}</b> wants to <b>${label}</b> on <b>${actorName}</b><br>
            <div style="margin-top: 6px; display: flex; gap: 6px;">
                <button data-action="lawful-approve" data-request-id="${requestId}"
                    style="background:#4caf50;color:#fff;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;">
                    Approve
                </button>
                <button data-action="lawful-deny" data-request-id="${requestId}"
                    style="background:#f44336;color:#fff;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;">
                    Deny
                </button>
            </div>
        </div>`,
        whisper: gmIds,
        speaker: { alias: "Lawful Sheets" }
    });
}

/* ============================================================ */
/* PRE-UPDATE ACTOR HOOK                                        */
/* ============================================================ */

function onPreUpdateActor(actor, changes, options, userId) {
    const user = game.users.get(userId);
    if (!user) return;
    if (user.role >= 3) return;
    if (isWhitelistedSource(options)) return;

    const flat = foundry.utils.flattenObject(changes);
    let blocked = false;
    const approvalGroups = new Map(); // category → { changes, label }

    for (const [path, newValue] of Object.entries(flat)) {
        if (path === "_id") continue;

        for (const mapping of ACTOR_PATH_MAP) {
            if (!mapping.pattern.test(path)) continue;

            const level = getLockLevel(mapping.category, userId);
            if (level === "none") break;

            // Special case: spell slot / spell point VALUE paths use subtraction rule
            if (mapping.category === "spellSlots") {
                const isNumericSpellPath = SPELL_NUMERIC_PATHS.some(p => p.test(path));
                if (isNumericSpellPath) {
                    const oldNum = Number(foundry.utils.getProperty(actor, path)) || 0;
                    const newNum = Number(newValue) || 0;
                    if (newNum <= oldNum) break; // Decrease = consumption, allow it
                }
            }

            const oldValue = foundry.utils.getProperty(actor, path);

            if (level === "locked") {
                logCheatAttempt(user, actor, path, oldValue, newValue);
                deletePath(changes, path);
                blocked = true;
            } else if (level === "request") {
                // Gather all approval-needed changes by category
                if (!approvalGroups.has(mapping.category)) {
                    approvalGroups.set(mapping.category, { changes: {}, label: mapping.category });
                }
                approvalGroups.get(mapping.category).changes[path] = newValue;
                deletePath(changes, path);
                blocked = true;
            }
            break;
        }
    }

    // Send one approval request per category group
    for (const [, group] of approvalGroups) {
        sendApprovalRequest(user, actor, `modify ${group.label}`, {
            type: "actor",
            actorId: actor.id,
            changes: group.changes
        });
    }

    if (blocked) {
        const remaining = foundry.utils.flattenObject(changes);
        const meaningfulKeys = Object.keys(remaining).filter(k => k !== "_id");
        if (meaningfulKeys.length === 0) return false;
    }
}

/* ============================================================ */
/* PRE-UPDATE ITEM HOOK                                         */
/* ============================================================ */

function onPreUpdateItem(item, changes, options, userId) {
    if (!item.parent || !(item.parent instanceof Actor)) return;

    const user = game.users.get(userId);
    if (!user || user.role >= 3) return;
    if (isWhitelistedSource(options)) return;

    const flat = foundry.utils.flattenObject(changes);
    let blocked = false;

    for (const [path, newValue] of Object.entries(flat)) {
        if (path === "_id") continue;

        // --- Inventory subcategory path checks ---

        // NUMERIC PATHS (quantity, uses.value): routed through "quantity" subcategory
        const numericMatch = INVENTORY_NUMERIC_PATHS.some(p => p.test(path));
        if (numericMatch) {
            const level = getLockLevel("inventory", userId, "quantity");
            if (level !== "none") {
                const oldNum = Number(foundry.utils.getProperty(item, path)) || 0;
                const newNum = Number(newValue) || 0;
                if (newNum > oldNum) {
                    // Increase = potentially cheating
                    const oldValue = foundry.utils.getProperty(item, path);
                    if (level === "locked") {
                        logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                        deletePath(changes, path);
                        blocked = true;
                    } else if (level === "request") {
                        sendApprovalRequest(user, item.parent, `increase ${path} on ${item.name}`, {
                            type: "updateItem",
                            actorId: item.parent.id,
                            itemId: item.id,
                            changes: { [path]: newValue }
                        });
                        deletePath(changes, path);
                        blocked = true;
                    }
                }
                // Decrease = legitimate usage, always allow
            }
            continue;
        }

        // SUBCATEGORY PATHS (equip, prepared, uses.max)
        const subMatch = INVENTORY_SUBCATEGORY_PATHS.find(e => e.pattern.test(path));
        if (subMatch) {
            const level = getLockLevel("inventory", userId, subMatch.subId);
            if (level !== "none") {
                const oldValue = foundry.utils.getProperty(item, path);
                if (level === "locked") {
                    logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                    deletePath(changes, path);
                    blocked = true;
                } else if (level === "request") {
                    const labels = { equip: "equip/unequip", prepared: "change prepared state", quantity: "modify uses" };
                    sendApprovalRequest(user, item.parent, `${labels[subMatch.subId] ?? path} on ${item.name}`, {
                        type: "updateItem",
                        actorId: item.parent.id,
                        itemId: item.id,
                        changes: { [path]: newValue }
                    });
                    deletePath(changes, path);
                    blocked = true;
                }
            }
            continue;
        }

        // Currency on container-type items
        if (item.type === "container" && isLocked("currency", userId)) {
            for (const pattern of CONTAINER_CURRENCY_PATHS) {
                if (pattern.test(path)) {
                    const oldNum = Number(foundry.utils.getProperty(item, path)) || 0;
                    const newNum = Number(newValue) || 0;
                    if (newNum > oldNum) {
                        logCheatAttempt(user, item, `${item.name} > ${path}`,
                            foundry.utils.getProperty(item, path), newValue);
                        deletePath(changes, path);
                        blocked = true;
                    }
                    break;
                }
            }
        }

        // Hit dice paths on class-type items (HP lock)
        if (item.type === "class" && isLocked("hp", userId)) {
            for (const pattern of HIT_DICE_ITEM_PATHS) {
                if (pattern.test(path)) {
                    logCheatAttempt(user, item, `${item.name} > ${path}`,
                        foundry.utils.getProperty(item, path), newValue);
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
        if (meaningfulKeys.length === 0) return false;
    }
}

/* ============================================================ */
/* PRE-CREATE ITEM HOOK                                         */
/* ============================================================ */

function onPreCreateItem(item, data, options, userId) {
    if (!item.parent || !(item.parent instanceof Actor)) return;

    const user = game.users.get(userId);
    if (!user || user.role >= 3) return;
    if (isWhitelistedSource(options)) return;

    const level = getLockLevel("inventory", userId, "addItems");
    if (level === "locked") {
        logCheatAttempt(user, item.parent, `Create item: ${data.name || "unknown"}`, "N/A", "new item");
        return false;
    }
    if (level === "request") {
        sendApprovalRequest(user, item.parent, `add "${data.name || "item"}" to inventory`, {
            type: "createItem",
            actorId: item.parent.id,
            itemData: data
        });
        return false;
    }
}

/* ============================================================ */
/* PRE-DELETE ITEM HOOK                                         */
/* ============================================================ */

function onPreDeleteItem(item, options, userId) {
    if (!item.parent || !(item.parent instanceof Actor)) return;

    const user = game.users.get(userId);
    if (!user || user.role >= 3) return;
    if (isWhitelistedSource(options)) return;

    const level = getLockLevel("inventory", userId, "deleteItems");
    if (level === "none") return;

    const quantity = item.system?.quantity ?? 0;
    const usesValue = item.system?.uses?.value ?? null;

    // Always allow deletion of the last item (consumption)
    if (quantity <= 1) return;

    // Always allow deletion when uses are depleted
    if (usesValue !== null && usesValue <= 0) return;

    // Stack with remaining items — check lock level
    if (level === "locked") {
        logCheatAttempt(user, item.parent, `Delete item: ${item.name} (qty: ${quantity})`, item.name, "deleted");
        return false;
    }
    if (level === "request") {
        sendApprovalRequest(user, item.parent, `delete "${item.name}" (qty: ${quantity})`, {
            type: "deleteItem",
            actorId: item.parent.id,
            itemId: item.id
        });
        return false;
    }
}

/* ============================================================ */
/* REGISTRATION                                                 */
/* ============================================================ */

export function registerValidationHooks() {
    Hooks.on("preUpdateActor", onPreUpdateActor);
    Hooks.on("preUpdateItem", onPreUpdateItem);
    Hooks.on("preCreateItem", onPreCreateItem);
    Hooks.on("preDeleteItem", onPreDeleteItem);
    console.log("Lawful Sheets | Validation hooks registered.");
}
