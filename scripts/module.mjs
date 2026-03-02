/**
 * Lawful Sheets v1.0.55
 * Enforces strict editing rules for Players with hook-based validation.
 * CSS enforcement provides the UX layer; preUpdate hooks provide real security.
 *
 * @module lawful-sheets
 * @author ogregod
 */

export const MODULE_ID = "lawful-sheets";

import { registerSettings } from "./settings.mjs";
import { applyEnforcement } from "./enforcer.mjs";
import { registerValidationHooks, handleTradeSocket } from "./validator.mjs";
import { LawfulManager } from "./manager.mjs";

/* ============================================================ */
/* INIT - Register settings                                     */
/* ============================================================ */

Hooks.once("init", () => {
    registerSettings();
    console.log("Lawful Sheets | Settings registered.");
});

/* ============================================================ */
/* READY - Apply enforcement and register validation hooks      */
/* ============================================================ */

Hooks.once("ready", () => {
    if (!game.user) return;

    registerValidationHooks();
    game.socket.on(`module.${MODULE_ID}`, handleTradeSocket);

    if (game.user.role < 3) {
        applyEnforcement();
    }

    console.log(`Lawful Sheets v1.0.57 | Ready. User: ${game.user.name} (Role ${game.user.role})`);
});

/* ============================================================ */
/* SCENE CONTROLS - Gavel button for GM management UI           */
/* ============================================================ */

Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user || game.user.role < 3) return;

    const tokenGroup = controls.tokens;
    if (!tokenGroup) return;

    tokenGroup.tools.lawfulConfig = {
        name: "lawfulConfig",
        title: "Lawful Sheets: Citizen Management",
        icon: "fa-solid fa-gavel",
        order: Object.keys(tokenGroup.tools).length,
        visible: true,
        button: true,
        onChange: () => {},
        onClick: () => {
            new LawfulManager().render(true);
        }
    };
});

/* ============================================================ */
/* CHAT APPROVAL BUTTONS                                        */
/* ============================================================ */

/**
 * Execute an approved action on the GM's client.
 * Uses { lawfulApproved: true } in options to bypass validation.
 */
async function executeApproval(requestData) {
    const opts = { lawfulApproved: true };
    const { type, actorId, itemId, changes, itemData } = requestData;

    if (type === "actor") {
        await game.actors.get(actorId)?.update(changes, opts);
    } else if (type === "updateItem") {
        const actor = game.actors.get(actorId);
        await actor?.items.get(itemId)?.update(changes, opts);
    } else if (type === "createItem") {
        await game.actors.get(actorId)?.createEmbeddedDocuments("Item", [itemData], opts);
    } else if (type === "deleteItem") {
        await game.actors.get(actorId)?.deleteEmbeddedDocuments("Item", [itemId], opts);
    }
}

/**
 * Wire up Approve / Deny buttons on Lawful Sheets approval chat cards.
 * Only GMs can see these messages (they are whispered to GMs).
 */
Hooks.on("renderChatMessage", (message, html) => {
    if (!game.user.isGM) return;
    if (!message.flags?.[MODULE_ID]?.approvalRequest) return;

    const requestData = message.flags[MODULE_ID].requestData;

    // In Foundry V13, html is a jQuery object — unwrap to get the DOM element
    const el = html instanceof HTMLElement ? html : html[0];
    if (!el) return;

    el.querySelector("[data-lawful-action='approve']")?.addEventListener("click", async () => {
        await executeApproval(requestData);
        await message.delete();
    });

    el.querySelector("[data-lawful-action='deny']")?.addEventListener("click", async () => {
        await message.delete();
    });
});
