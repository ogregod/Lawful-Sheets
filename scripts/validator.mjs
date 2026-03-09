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
 * Bidirectional trade matching.
 *
 * The core problem: preUpdateActor hooks fire independently on each client.
 * If the receiver's hook fires before the payer's socket message arrives,
 * a simple "wait for decrease then allow increase" approach fails.
 *
 * Solution: maintain BOTH a pending-decrease table AND a pending-increase table.
 * - When a decrease fires: first check if a blocked increase is already waiting.
 *   If yes → immediately unblock it. If no → store the decrease for later.
 * - When an increase fires with no immediate decrease match: store it as a
 *   pending increase. If a matching decrease arrives (via socket or locally),
 *   handleTradeSocket finds it and re-applies immediately.
 * - Fallback: if no matching decrease arrives within 5 s, log as cheat.
 *
 * This means the ORDER of events doesn't matter — whichever side arrives
 * first, the match is resolved correctly.
 *
 * Keys for both maps: "${path}:${amount}"  (e.g. "system.currency.gp:5")
 */
const pendingTradeDecreases = new Map(); // Value: Array of { actorId, timestamp }
const pendingTradeIncreases = new Map(); // Value: Array of { id, actorId, newValue, oldValue, level, user, timestamp }

// Item trade tracking — same bidirectional pattern as currency
const pendingItemTradeDeletes  = new Map(); // Key: itemName, Value: Array of { actorId, timestamp }
const pendingItemTradeCreates  = new Map(); // Key: itemName, Value: Array of { id, actorId, itemData, level, user, timestamp }
const pendingItemTradeIncreases = new Map(); // Key: itemName, Value: Array of { id, actorId, itemId, newQty, level, user, timestamp }

const TRADE_WINDOW_MS = 30_000;

/**
 * Called both locally (on the decreasing client) and via socket (on all other clients).
 * First tries to unblock a waiting increase; otherwise stores the decrease for later.
 */
export function handleTradeSocket(data) {
    if (!data?.type) return;

    if (data.type === "lawful-trade-decrease") {
        const { path, amount, actorId: senderActorId, timestamp } = data;
        const key = `${path}:${amount}`;
        console.log(`Lawful Sheets | Trade decrease received: ${key} from actor ${senderActorId}`);

        // Can we immediately unblock a pending increase from a DIFFERENT actor?
        const increases = pendingTradeIncreases.get(key);
        if (increases?.length) {
            const idx = increases.findIndex(e => e.actorId !== senderActorId);
            if (idx >= 0) {
                const entry = increases.splice(idx, 1)[0];
                if (increases.length === 0) pendingTradeIncreases.delete(key);
                console.log(`Lawful Sheets | Trade matched — unblocking increase on actor ${entry.actorId}`);
                game.actors.get(entry.actorId)?.update(
                    { [path]: entry.newValue },
                    { lawfulApproved: true }
                );
                return;
            }
        }

        if (!pendingTradeDecreases.has(key)) pendingTradeDecreases.set(key, []);
        pendingTradeDecreases.get(key).push({ actorId: senderActorId, timestamp: timestamp ?? Date.now() });
        _cleanExpiredTrades();

    } else if (data.type === "lawful-item-delete") {
        const { actorId: senderActorId, itemName, timestamp } = data;
        console.log(`Lawful Sheets | Item delete received: "${itemName}" from actor ${senderActorId}`);

        // Can we match a pending blocked create from a DIFFERENT actor?
        const creates = pendingItemTradeCreates.get(itemName);
        if (creates?.length) {
            const idx = creates.findIndex(e => e.actorId !== senderActorId);
            if (idx >= 0) {
                const entry = creates.splice(idx, 1)[0];
                if (creates.length === 0) pendingItemTradeCreates.delete(itemName);
                // Trade confirmed — re-create the item. The original preCreateItem call
                // returned false (blocking the player's attempt), so we must create it
                // here. This runs only on the receiver's client (the only client that
                // stored the pending entry), so there is no risk of duplicates.
                console.log(`Lawful Sheets | Item trade matched — creating "${itemName}" on actor ${entry.actorId}`);
                const createData = foundry.utils.deepClone(entry.itemData);
                delete createData._id;
                game.actors.get(entry.actorId)?.createEmbeddedDocuments("Item", [createData], { lawfulApproved: true });
                return;
            }
        }

        // Can we match a pending blocked qty-increase from a DIFFERENT actor? (item merge trade)
        const qtyIncreases = pendingItemTradeIncreases.get(itemName);
        if (qtyIncreases?.length) {
            const idx = qtyIncreases.findIndex(e => e.actorId !== senderActorId);
            if (idx >= 0) {
                const entry = qtyIncreases.splice(idx, 1)[0];
                if (qtyIncreases.length === 0) pendingItemTradeIncreases.delete(itemName);
                console.log(`Lawful Sheets | Item qty trade matched — updating "${itemName}" on actor ${entry.actorId}`);
                game.actors.get(entry.actorId)?.items.get(entry.itemId)?.update(
                    { "system.quantity": entry.newQty },
                    { lawfulApproved: true }
                );
                return;
            }
        }

        if (!pendingItemTradeDeletes.has(itemName)) pendingItemTradeDeletes.set(itemName, []);
        pendingItemTradeDeletes.get(itemName).push({ actorId: senderActorId, timestamp: timestamp ?? Date.now() });
        _cleanExpiredTrades();
    }
}

function _cleanExpiredTrades() {
    const cutoff = Date.now() - TRADE_WINDOW_MS;
    for (const [key, entries] of pendingTradeDecreases) {
        const fresh = entries.filter(e => e.timestamp > cutoff);
        if (fresh.length === 0) pendingTradeDecreases.delete(key);
        else pendingTradeDecreases.set(key, fresh);
    }
    for (const [key, entries] of pendingTradeIncreases) {
        const fresh = entries.filter(e => e.timestamp > cutoff);
        if (fresh.length === 0) pendingTradeIncreases.delete(key);
        else pendingTradeIncreases.set(key, fresh);
    }
    for (const [key, entries] of pendingItemTradeDeletes) {
        const fresh = entries.filter(e => e.timestamp > cutoff);
        if (fresh.length === 0) pendingItemTradeDeletes.delete(key);
        else pendingItemTradeDeletes.set(key, fresh);
    }
    for (const [key, entries] of pendingItemTradeCreates) {
        const fresh = entries.filter(e => e.timestamp > cutoff);
        if (fresh.length === 0) pendingItemTradeCreates.delete(key);
        else pendingItemTradeCreates.set(key, fresh);
    }
    for (const [key, entries] of pendingItemTradeIncreases) {
        const fresh = entries.filter(e => e.timestamp > cutoff);
        if (fresh.length === 0) pendingItemTradeIncreases.delete(key);
        else pendingItemTradeIncreases.set(key, fresh);
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

/**
 * Check whether an item creation on receiverActorId can be matched against
 * a pending item delete of the same name from a different actor.
 * Consumes the match if found.
 * @returns {boolean} true if this creation is part of a legitimate trade
 */
function consumeItemTradeDelete(receiverActorId, itemName) {
    _cleanExpiredTrades();
    const entries = pendingItemTradeDeletes.get(itemName);
    if (!entries || entries.length === 0) return false;
    const idx = entries.findIndex(e => e.actorId !== receiverActorId);
    if (idx < 0) return false;
    entries.splice(idx, 1);
    if (entries.length === 0) pendingItemTradeDeletes.delete(itemName);
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

    // dnd5e may nest activity context under a namespace in newer versions
    if (options.dnd5e?.activityId) return true;

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
            // - Increase → allow immediately if a matching decrease is already registered.
            //   If not, store as a pending increase; handleTradeSocket will unblock it
            //   the moment the payer's decrease arrives. Fallback: 5 s cheat detection.
            if (mapping.category === "currency") {
                if (newNum < oldNum) {
                    const tradeData = {
                        type: "lawful-trade-decrease",
                        path,
                        amount: oldNum - newNum,
                        actorId: actor.id,
                        timestamp: Date.now()
                    };
                    console.log(`Lawful Sheets | Trade decrease detected: ${path} -${oldNum - newNum} on actor ${actor.id}`);
                    handleTradeSocket(tradeData);                        // Record on this client too
                    game.socket.emit(`module.${MODULE_ID}`, tradeData); // Broadcast to other clients
                    break; // Allow the decrease
                }
                if (newNum > oldNum) {
                    if (consumeTradeDecrease(path, newNum - oldNum, actor.id)) break; // Immediate match — allow
                    // No immediate match. Register this increase as pending so that
                    // handleTradeSocket can unblock it the moment the payer's decrease
                    // is recorded (whether from a local call or an incoming socket message).
                    const amt    = newNum - oldNum;
                    const incKey = `${path}:${amt}`;
                    const incId  = foundry.utils.randomID();
                    const incEntry = {
                        id: incId, actorId: actor.id,
                        newValue, oldValue, level, user,
                        timestamp: Date.now()
                    };
                    console.log(`Lawful Sheets | Trade increase blocked (waiting for decrease): ${incKey} on actor ${actor.id}`);
                    if (!pendingTradeIncreases.has(incKey)) pendingTradeIncreases.set(incKey, []);
                    pendingTradeIncreases.get(incKey).push(incEntry);

                    // Fallback: if no matching decrease arrives within 5 s, treat as unauthorized
                    setTimeout(() => {
                        const list = pendingTradeIncreases.get(incKey);
                        if (!list) return;
                        const idx = list.findIndex(e => e.id === incId);
                        if (idx < 0) return; // Already matched and applied by handleTradeSocket
                        list.splice(idx, 1);
                        if (list.length === 0) pendingTradeIncreases.delete(incKey);
                        const actorDoc = game.actors.get(incEntry.actorId);
                        if (!actorDoc) return;
                        if (incEntry.level === "locked") {
                            logCheatAttempt(incEntry.user, actorDoc, path, incEntry.oldValue, incEntry.newValue);
                        } else if (incEntry.level === "request") {
                            sendApprovalRequest(incEntry.user, actorDoc, `modify ${path}`, {
                                type: "actor",
                                actorId: incEntry.actorId,
                                changes: { [path]: incEntry.newValue }
                            });
                        }
                    }, 5000);
                    deletePath(changes, path);
                    blocked = true;
                    break; // Don't fall through to the generic level check below
                }
            }

            // Spell slots/points & class resources: apply subtraction rule.
            // Decreases (casting spells, spending ki, etc.) are legitimate usage.
            // Increases (manually adding points) are blocked as cheating.
            // Rests (isRest=true) are already whitelisted, so recovery still works.
            // Third-party modules (e.g. dnd5e-spellpoints) may not set isActivity,
            // so we cannot rely solely on the whitelist for these categories.
            if (mapping.category === "spellSlots" || mapping.category === "resources" || mapping.category === "hp") {
                // Non-numeric values (objects) occur when dnd5e sends the full
                // resources/spells object. We can't determine direction from objects,
                // so allow them through — individual numeric sub-paths will be
                // validated separately if they appear as flattened keys.
                if (isNaN(oldNum) || isNaN(newNum)) break;
                if (newNum <= oldNum) break; // Spending / consuming = allow
                // Increase falls through to the generic lock check below
            }

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
                const isUsesValue = /^system\.uses\.value$/.test(path);
                // Spell-slots lock governs uses.value with subtraction rule:
                // Decreases (using charges/casting) are legitimate, only increases are blocked.
                // Third-party modules (e.g. dnd5e-spellpoints) call item.update() without
                // isActivity, so we cannot block all directions.
                if (isUsesValue && spellSlotsLevel !== "none" && newNum > oldNum) {
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
                    const isQtyPath = /^system\.quantity$/.test(path);
                    if (isQtyPath && consumeItemTradeDelete(item.parent.id, item.name)) {
                        // Immediate trade match — allow the quantity increase
                    } else if (isQtyPath) {
                        // No immediate match — store pending; handleTradeSocket will re-apply
                        // the update when the sender's delete signal arrives.
                        const incId = foundry.utils.randomID();
                        const itemName = item.name;
                        const itemId = item.id;
                        const actorId = item.parent.id;
                        const incEntry = { id: incId, actorId, itemId, newQty: newNum, level: inventoryLevel, user, timestamp: Date.now() };
                        if (!pendingItemTradeIncreases.has(itemName)) pendingItemTradeIncreases.set(itemName, []);
                        pendingItemTradeIncreases.get(itemName).push(incEntry);
                        console.log(`Lawful Sheets | Qty increase blocked (waiting for delete): "${itemName}" on actor ${actorId}`);
                        setTimeout(() => {
                            const list = pendingItemTradeIncreases.get(itemName);
                            if (!list) return;
                            const idx = list.findIndex(e => e.id === incId);
                            if (idx < 0) return; // Already matched by handleTradeSocket
                            list.splice(idx, 1);
                            if (list.length === 0) pendingItemTradeIncreases.delete(itemName);
                            const actorDoc = game.actors.get(actorId);
                            if (!actorDoc) return;
                            if (incEntry.level === "locked") {
                                logCheatAttempt(incEntry.user, actorDoc, `${itemName} > ${path}`, oldNum, newNum);
                            } else if (incEntry.level === "request") {
                                sendApprovalRequest(incEntry.user, actorDoc, `increase ${path} on ${itemName}`, {
                                    type: "updateItem",
                                    actorId,
                                    itemId,
                                    changes: { [path]: newNum }
                                });
                            }
                        }, 5000);
                        pathBlocked = true;
                    } else {
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
            }
            if (!pathBlocked) {
                allowedFlat[path] = newValue;
                // A quantity decrease means the player sent items to another actor.
                // Broadcast via socket so the receiver's preCreateItem can match it
                // and suppress the false cheat alert on the receiving side.
                if (/^system\.quantity$/.test(path) && oldNum > newNum) {
                    const deleteTradeData = {
                        type: "lawful-item-delete",
                        actorId: item.parent.id,
                        itemName: item.name,
                        timestamp: Date.now()
                    };
                    handleTradeSocket(deleteTradeData);
                    game.socket.emit(`module.${MODULE_ID}`, deleteTradeData);
                }
            } else anyBlocked = true;
            continue;
        }

        // INVERSE NUMERIC PATHS (uses.spent)
        // In dnd5e v4, uses.value is derived as (max - spent).
        // Inverted subtraction rule: block DECREASES only (reducing spent = recovering
        // resources = cheating). Increases (spending/using) are always allowed.
        // Third-party modules (e.g. dnd5e-spellpoints) call item.update() without
        // isActivity, so we apply the subtraction rule rather than blocking all.
        const inverseNumericMatch = INVENTORY_INVERSE_NUMERIC_PATHS.some(p => p.test(path));
        if (inverseNumericMatch) {
            const inventoryLevel = getLockLevel("inventory", userId, "quantity");
            const spellSlotsLevel = getLockLevel("spellSlots", userId);
            const oldNum = Number(foundry.utils.getProperty(item, path)) || 0;
            const newNum = Number(newValue) || 0;
            if (oldNum !== newNum) {
                const oldValue = foundry.utils.getProperty(item, path);
                // spellSlots lock: block decreases (recovering = cheating), allow increases (using)
                if (spellSlotsLevel !== "none" && newNum < oldNum) {
                    if (spellSlotsLevel === "locked") {
                        logCheatAttempt(user, item, `${item.name} > ${path}`, oldValue, newValue);
                        pathBlocked = true;
                    } else if (spellSlotsLevel === "request") {
                        sendApprovalRequest(user, item.parent, `recover uses via ${path} on ${item.name}`, {
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
                // Skip if the value hasn't actually changed.
                // Foundry (and some modules) sometimes include unchanged fields in batch updates.
                const oldNum = Number(oldValue ?? 0);
                const newNum = Number(newValue ?? 0);
                const noRealChange = oldValue === newValue || (!isNaN(oldNum) && !isNaN(newNum) && oldNum === newNum);
                if (!noRealChange) {
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
        // If a matching quantity-decrease (or delete) from a different actor was already
        // recorded, this is a legitimate trade. Allow the creation — Item Piles uses the
        // receiver's own player client to create the item, so we must let it through.
        if (consumeItemTradeDelete(item.parent.id, data.name)) return;

        // No immediate match — store as pending; handleTradeSocket will match it when
        // the sender's socket message arrives and remove it before the fallback fires.
        const incId = foundry.utils.randomID();
        const incEntry = { id: incId, actorId: item.parent.id, itemData: data, level, user, timestamp: Date.now() };
        const pendingKey = data.name ?? "unknown";
        console.log(`Lawful Sheets | Item create blocked (waiting for delete): "${pendingKey}" on actor ${item.parent.id}`);
        if (!pendingItemTradeCreates.has(pendingKey)) pendingItemTradeCreates.set(pendingKey, []);
        pendingItemTradeCreates.get(pendingKey).push(incEntry);

        setTimeout(() => {
            const list = pendingItemTradeCreates.get(pendingKey);
            if (!list) return;
            const idx = list.findIndex(e => e.id === incId);
            if (idx < 0) return; // Already matched by handleTradeSocket
            list.splice(idx, 1);
            if (list.length === 0) pendingItemTradeCreates.delete(pendingKey);
            const actorDoc = game.actors.get(incEntry.actorId);
            if (!actorDoc) return;
            logCheatAttempt(incEntry.user, actorDoc, `Create item: ${data.name || "unknown"}`, "N/A", "new item");
        }, 5000);

        return false;
    }
    if (level === "request") {
        // Same trade-detection bypass as "locked" above — allow the creation through
        if (consumeItemTradeDelete(item.parent.id, data.name)) return;

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

    // Apply blocking logic only if source is not whitelisted.
    // Note: stack deletions (qty > 1) are intentionally allowed because Item Piles
    // deletes the sender's item when ALL quantity is traded. Blocking stacks would
    // prevent the trade signal from being emitted and break item merge trades.
    // Single-item (qty ≤ 1) non-depleted deletions are still blocked as cheating.
    if (!isWhitelistedSource(options)) {
        const level = getLockLevel("inventory", userId, "deleteItems");
        if (level !== "none") {
            const quantity = item.system?.quantity ?? 0;
            const usesValue = item.system?.uses?.value ?? null;
            const isDepletedUses = usesValue !== null && usesValue <= 0;

            if (quantity <= 1 && !isDepletedUses) {
                if (level === "locked") {
                    logCheatAttempt(user, item.parent, `Delete item: ${item.name}`, item.name, "deleted");
                    return false;
                }
                if (level === "request") {
                    sendApprovalRequest(user, item.parent, `delete "${item.name}"`, {
                        type: "deleteItem",
                        actorId: item.parent.id,
                        itemId: item.id
                    });
                    return false;
                }
            }
        }
    }

    // Deletion is allowed — broadcast for item trade detection so the receiver's
    // preCreateItem can match this against an incoming item creation.
    const deleteTradeData = {
        type: "lawful-item-delete",
        actorId: item.parent.id,
        itemName: item.name,
        timestamp: Date.now()
    };
    handleTradeSocket(deleteTradeData);                        // Register on this client too
    game.socket.emit(`module.${MODULE_ID}`, deleteTradeData); // Broadcast to other clients
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
