/**
 * Lawful Sheets - Validator
 * Hooks into preUpdateActor, preUpdateItem, preCreateItem, and preDeleteItem
 * to reject or escalate unauthorized data changes on the client.
 */

import { isLocked, getLockLevel } from "./settings.mjs";

const MODULE_ID = "lawful-sheets";

/* ============================================================ */
/* PATH-TO-CATEGORY MAPPING                                     */
/* ============================================================ */

/**
 * Maps data paths to lock categories for actor updates.
 * Each entry: { pattern: RegExp, category: string }
 */
const ACTOR_PATH_MAP = [
    // HP — Current HP / Temp HP (more specific patterns first)
    { pattern: /^system\.attributes\.hp\.value$/,   category: "hp", subId: "current" },
    { pattern: /^system\.attributes\.hp\.temp/,     category: "hp", subId: "current" },  // .temp + .tempmax
    { pattern: /^system\.attributes\.hp\.min$/,     category: "hp", subId: "current" },
    // HP — Max HP
    { pattern: /^system\.attributes\.hp\.max/,      category: "hp", subId: "max" },
    { pattern: /^system\.attributes\.hp\.formula$/, category: "hp", subId: "max" },
    // HP — catch-all for any other hp sub-paths (treated as current)
    { pattern: /^system\.attributes\.hp\./,         category: "hp", subId: "current" },
    // Hit Dice
    { pattern: /^system\.attributes\.hd\./,         category: "hp", subId: "hitDice" },
    { pattern: /^system\.attributes\.hd$/,          category: "hp", subId: "hitDice" },

    // Ability Scores
    { pattern: /^system\.abilities\.\w+\.value$/, category: "abilities" },

    // Currency
    { pattern: /^system\.currency\./,  category: "currency" },
    { pattern: /^system\.currency$/,   category: "currency" },

    // Spell Slots & Spell Points
    { pattern: /^system\.spells\./,  category: "spellSlots" },
    { pattern: /^system\.spells$/,   category: "spellSlots" },

    // Class Resources (ki points, rage uses, bardic inspiration charges, etc.)
    { pattern: /^system\.resources\./, category: "resources" },
    { pattern: /^system\.resources$/,  category: "resources" },

    // Experience Points
    { pattern: /^system\.details\.xp\./, category: "xp" },
    { pattern: /^system\.details\.xp$/,  category: "xp" },

    // Death Saves
    { pattern: /^system\.attributes\.death\./, category: "deathSaves" },
    { pattern: /^system\.attributes\.death$/,  category: "deathSaves" },

    // Inspiration
    { pattern: /^system\.attributes\.inspiration$/, category: "inspiration" },

    // Exhaustion
    { pattern: /^system\.attributes\.exhaustion$/, category: "exhaustion" }
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
 * Paths on embedded items where DECREASES are blocked (cheating by reducing "spent" = gaining resources),
 * but INCREASES are allowed (legitimate usage consumption).
 * dnd5e v4 derives uses.value as (max - spent), so blocking spent decreases is equivalent
 * to blocking uses.value increases when both are sent in the same update payload.
 * Routed through the "quantity" subcategory.
 */
const INVENTORY_INVERSE_NUMERIC_PATHS = [
    /^system\.uses\.spent$/
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
/* TRADE DETECTION                                              */
/* ============================================================ */

/**
 * Cross-client registry of recent currency decreases that may be the "payer"
 * side of a legitimate trade.
 *
 * When a non-GM player's currency DECREASES on any client, that client
 * broadcasts a socket message. All other clients receive it and add an entry
 * here. When a currency INCREASE is then detected on a different actor,
 * consumeTradeDecrease checks for a match and, if found, allows the increase.
 *
 * Key: "${path}:${amount}"  (e.g. "system.currency.gp:5")
 * Value: Array of { actorId, timestamp }
 */
const pendingTradeDecreases = new Map();

const TRADE_WINDOW_MS = 30_000;

/** Called by the module's socket listener to register a remote trade decrease. */
export function handleTradeSocket(data) {
    if (data?.type !== "lawful-trade-decrease") return;
    const { path, amount, actorId, timestamp } = data;
    const key = `${path}:${amount}`;
    if (!pendingTradeDecreases.has(key)) pendingTradeDecreases.set(key, []);
    pendingTradeDecreases.get(key).push({ actorId, timestamp });
    _cleanExpiredTrades();
}

function _cleanExpiredTrades() {
    const cutoff = Date.now() - TRADE_WINDOW_MS;
    for (const [key, entries] of pendingTradeDecreases) {
        const fresh = entries.filter(e => e.timestamp > cutoff);
        if (fresh.length === 0) pendingTradeDecreases.delete(key);
        else pendingTradeDecreases.set(key, fresh);
    }
}

/**
 * Check whether a currency increase on receiverActorId can be matched against
 * a pending trade decrease of the same path/amount from a different actor.
 * Consumes the match if found.
 * @returns {boolean} true if this increase is part of a legitimate trade
 */
function consumeTradeDecrease(path, amount, receiverActorId) {
    _cleanExpiredTrades();
    const key = `${path}:${amount}`;
    const entries = pendingTradeDecreases.get(key);
    if (!entries || entries.length === 0) return false;
    const idx = entries.findIndex(e => e.actorId !== receiverActorId);
    if (idx < 0) return false;
    entries.splice(idx, 1);
    if (entries.length === 0) pendingTradeDecreases.delete(key);
    return true;
}

/* ============================================================ */
/* UTILITY FUNCTIONS                                            */
/* ============================================================ */

/**
 * Delete a dot-notation path from a nested object.
 * Handles both flat dot-notation keys (e.g. { "system.spells.points.value": 15 })
 * and fully nested objects (e.g. { system: { currency: { gp: 10 } } }).
 * Cleans up empty parent containers afterward.
 */
function deletePath(obj, path) {
    // Fast path: the key exists directly on the object as a flat dot-notation string.
    // dnd5e sometimes sends updates this way (e.g. spell points, individual fields).
    if (Object.prototype.hasOwnProperty.call(obj, path)) {
        delete obj[path];
        return;
    }

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
                <button data-lawful-action="approve"
                    style="background:#4caf50;color:#fff;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;">
                    Approve
                </button>
                <button data-lawful-action="deny"
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

            const level = getLockLevel(mapping.category, userId, mapping.subId ?? null);
            if (level === "none") break;

            const oldValue = foundry.utils.getProperty(actor, path);

            // Skip if the value didn't actually change.
            // dnd5e often sends full objects (all currency fields, all HP fields)
            // even when only one field was edited. We only act on real changes.
            // Use numeric comparison so that null and 0 are treated as equivalent
            // (e.g. system.attributes.hp.temp going from 0 → null is not a real change).
            const oldNum = Number(oldValue ?? 0);
            const newNum = Number(newValue ?? 0);
            const noRealChange = oldValue === newValue || (!isNaN(oldNum) && !isNaN(newNum) && oldNum === newNum);
            if (noRealChange) break;

            // Currency trade detection:
            // - Decrease → always allow (paying in a trade / spending). Record locally
            //   AND broadcast via socket so every other client also records the offer.
            //   (Foundry does not loop socket messages back to the sender, so we must
            //   call handleTradeSocket ourselves to register the decrease on this client.)
            // - Increase → allow if a matching decrease from a DIFFERENT actor is already
            //   in pendingTradeDecreases. If no match yet, block the update temporarily
            //   and retry after 1 s — long enough for the socket message from the payer's
            //   client to arrive. Re-apply via lawfulApproved if a match arrives; otherwise
            //   treat as a cheat attempt.
            if (mapping.category === "currency") {
                if (newNum < oldNum) {
                    const tradeData = {
                        type: "lawful-trade-decrease",
                        path,
                        amount: oldNum - newNum,
                        actorId: actor.id,
                        timestamp: Date.now()
                    };
                    handleTradeSocket(tradeData);                        // Record on this client too
                    game.socket.emit(`module.${MODULE_ID}`, tradeData); // Broadcast to other clients
                    break; // Allow the decrease
                }
                if (newNum > oldNum) {
                    if (consumeTradeDecrease(path, newNum - oldNum, actor.id)) break; // Trade — allow
                    // No immediate match. The payer's socket message may not have arrived yet.
                    // Block the update now; re-apply it once a matching offer is confirmed.
                    const capturedPath  = path;
                    const capturedOld   = oldValue;
                    const capturedNew   = newValue;
                    const capturedAmt   = newNum - oldNum;
                    const capturedAId   = actor.id;
                    const capturedUser  = user;
                    const capturedLevel = level;
                    setTimeout(() => {
                        const actorDoc = game.actors.get(capturedAId);
                        if (!actorDoc) return;
                        if (consumeTradeDecrease(capturedPath, capturedAmt, capturedAId)) {
                            actorDoc.update({ [capturedPath]: capturedNew }, { lawfulApproved: true });
                        } else if (capturedLevel === "locked") {
                            logCheatAttempt(capturedUser, actorDoc, capturedPath, capturedOld, capturedNew);
                        } else if (capturedLevel === "request") {
                            sendApprovalRequest(capturedUser, actorDoc, `modify ${capturedPath}`, {
                                type: "actor",
                                actorId: capturedAId,
                                changes: { [capturedPath]: capturedNew }
                            });
                        }
                    }, 1000);
                    deletePath(changes, path);
                    blocked = true;
                    break; // Don't fall through to the generic level check below
                }
            }

            // Spell slots: ALL manual changes are blocked regardless of direction.
            // Legitimate consumption (casting spells) arrives with isActivity=true and
            // is already whitelisted by isWhitelistedSource before reaching this point.
            // Rests (isRest=true) are likewise whitelisted, so recovery still works.

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
    const allowedFlat = {};   // paths that are permitted to go through
    let anyBlocked = false;

    for (const [path, newValue] of Object.entries(flat)) {
        // Always preserve internal Foundry fields
        if (path === "_id" || path.startsWith("_")) {
            allowedFlat[path] = newValue;
            continue;
        }

        let pathBlocked = false;

        // NUMERIC PATHS (quantity, uses.value)
        // - spellSlots lock active → block ALL manual changes in both directions.
        //   Spell casting (isActivity=true) and rests (isRest=true) are already
        //   whitelisted above, so legitimate usage always goes through.
        // - spellSlots lock inactive → subtraction rule: block increases only
        //   (gaining resources is cheating; spending is legitimate consumption).
        const numericMatch = INVENTORY_NUMERIC_PATHS.some(p => p.test(path));
        if (numericMatch) {
            const inventoryLevel = getLockLevel("inventory", userId, "quantity");
            const spellSlotsLevel = getLockLevel("spellSlots", userId);
            const oldNum = Number(foundry.utils.getProperty(item, path)) || 0;
            const newNum = Number(newValue) || 0;
            if (oldNum !== newNum) {
                const oldValue = foundry.utils.getProperty(item, path);
                if (spellSlotsLevel !== "none") {
                    if (spellSlotsLevel === "locked") {
                        logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                        pathBlocked = true;
                    } else if (spellSlotsLevel === "request") {
                        sendApprovalRequest(user, item.parent, `modify ${path} on ${item.name}`, {
                            type: "updateItem",
                            actorId: item.parent.id,
                            itemId: item.id,
                            changes: { [path]: newValue }
                        });
                        pathBlocked = true;
                    }
                } else if (inventoryLevel !== "none" && newNum > oldNum) {
                    if (inventoryLevel === "locked") {
                        logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                        pathBlocked = true;
                    } else if (inventoryLevel === "request") {
                        sendApprovalRequest(user, item.parent, `increase ${path} on ${item.name}`, {
                            type: "updateItem",
                            actorId: item.parent.id,
                            itemId: item.id,
                            changes: { [path]: newValue }
                        });
                        pathBlocked = true;
                    }
                }
            }
            if (!pathBlocked) allowedFlat[path] = newValue;
            else anyBlocked = true;
            continue;
        }

        // INVERSE NUMERIC PATHS (uses.spent)
        // In dnd5e v4, uses.value is derived as (max - spent).
        // - spellSlots lock active → block ALL manual changes in both directions (same
        //   logic as uses.value above; spell casting is whitelisted via isActivity).
        // - spellSlots lock inactive → inverted subtraction rule: block decreases only
        //   (reducing spent = recovering resources = cheating; increasing spent = using = OK).
        const inverseNumericMatch = INVENTORY_INVERSE_NUMERIC_PATHS.some(p => p.test(path));
        if (inverseNumericMatch) {
            const inventoryLevel = getLockLevel("inventory", userId, "quantity");
            const spellSlotsLevel = getLockLevel("spellSlots", userId);
            const oldNum = Number(foundry.utils.getProperty(item, path)) || 0;
            const newNum = Number(newValue) || 0;
            if (oldNum !== newNum) {
                const oldValue = foundry.utils.getProperty(item, path);
                if (spellSlotsLevel !== "none") {
                    if (spellSlotsLevel === "locked") {
                        logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                        pathBlocked = true;
                    } else if (spellSlotsLevel === "request") {
                        sendApprovalRequest(user, item.parent, `modify ${path} on ${item.name}`, {
                            type: "updateItem",
                            actorId: item.parent.id,
                            itemId: item.id,
                            changes: { [path]: newValue }
                        });
                        pathBlocked = true;
                    }
                } else if (inventoryLevel !== "none" && newNum < oldNum) {
                    if (inventoryLevel === "locked") {
                        logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                        pathBlocked = true;
                    } else if (inventoryLevel === "request") {
                        sendApprovalRequest(user, item.parent, `recover uses via ${path} on ${item.name}`, {
                            type: "updateItem",
                            actorId: item.parent.id,
                            itemId: item.id,
                            changes: { [path]: newValue }
                        });
                        pathBlocked = true;
                    }
                }
            }
            if (!pathBlocked) allowedFlat[path] = newValue;
            else anyBlocked = true;
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
                    pathBlocked = true;
                } else if (level === "request") {
                    const labels = { equip: "equip/unequip", prepared: "change prepared state", quantity: "modify uses" };
                    sendApprovalRequest(user, item.parent, `${labels[subMatch.subId] ?? path} on ${item.name}`, {
                        type: "updateItem",
                        actorId: item.parent.id,
                        itemId: item.id,
                        changes: { [path]: newValue }
                    });
                    pathBlocked = true;
                }
            }
            if (!pathBlocked) allowedFlat[path] = newValue;
            else anyBlocked = true;
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
                        pathBlocked = true;
                    }
                    break;
                }
            }
        }

        // Hit dice paths on class-type items (HP lock)
        if (!pathBlocked && item.type === "class" && isLocked("hp", userId, "hitDice")) {
            for (const pattern of HIT_DICE_ITEM_PATHS) {
                if (pattern.test(path)) {
                    logCheatAttempt(user, item, `${item.name} > ${path}`,
                        foundry.utils.getProperty(item, path), newValue);
                    pathBlocked = true;
                    break;
                }
            }
        }

        if (!pathBlocked) allowedFlat[path] = newValue;
        else anyBlocked = true;
    }

    if (!anyBlocked) return; // Nothing was blocked, let original update through

    // Something was blocked. Always cancel the original update.
    // If there are remaining allowed changes, re-issue them with the bypass flag
    // so they pass through validation without triggering hooks again.
    const allowedKeys = Object.keys(allowedFlat).filter(k => !k.startsWith("_"));
    if (allowedKeys.length > 0) {
        item.update(allowedFlat, { ...options, lawfulApproved: true });
    }
    return false;
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
