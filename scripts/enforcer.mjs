/**
 * Lawful Sheets - CSS Enforcer
 * Injects CSS rules to disable UI elements for locked categories.
 * This is the UX layer — the real security is in validator.mjs.
 */

import { LOCK_CATEGORIES, isLocked } from "./settings.mjs";

const MODULE_ID = "lawful-sheets";

/**
 * CSS rules mapped to each lock category.
 * These disable/hide UI elements on the character sheet.
 */
const CSS_RULES = {

    editMode: `
        slide-toggle,
        .mode-slider,
        .toggle-editing,
        .sheet-header .configure-sheet,
        button.configure-sheet {
            display: none !important;
        }
    `,

    contextMenu: `
        #context-menu li.context-item:has(.fa-edit),
        #context-menu li.context-item:has(.fa-pen),
        #context-menu li.context-item:has(.fa-pen-to-square),
        #context-menu li.context-item:has(.fa-trash),
        #context-menu li.context-item:has(.fa-trash-can),
        #context-menu li.context-item:has(.fa-copy) {
            display: none !important;
        }
    `,

    hp: `
        /* Lock HP value, max, temp, tempmax inputs */
        .sheet.actor input[name="system.attributes.hp.value"],
        .sheet.actor input[name="system.attributes.hp.max"],
        .sheet.actor input[name="system.attributes.hp.temp"],
        .sheet.actor input[name="system.attributes.hp.tempmax"] {
            pointer-events: none !important;
            background: transparent !important;
            border: none !important;
            cursor: default !important;
        }
        /* Lock HP meter group interactions */
        .sheet.actor .meter-group .meter.hit-points {
            pointer-events: none !important;
        }
        /* Lock hit dice inputs and controls */
        .sheet.actor .hit-dice input,
        .sheet.actor .hit-dice .adjustment-button,
        .sheet.actor [data-action="hitDie"] input,
        .sheet.actor input[name^="system.attributes.hd."] {
            pointer-events: none !important;
        }
        /* Keep rollable buttons working (saving throws, rests, etc.) */
        .sheet.actor .meter-group button.rollable,
        .sheet.actor .meter-group button[data-action="roll"],
        .sheet.actor .sidebar button.rollable,
        .sheet.actor button[data-action="shortRest"],
        .sheet.actor button[data-action="longRest"] {
            pointer-events: auto !important;
            cursor: pointer !important;
        }
    `,

    abilities: `
        /* Lock all six ability score inputs */
        .sheet.actor input[name^="system.abilities."][name$=".value"] {
            pointer-events: none !important;
            background: transparent !important;
            border: none !important;
            cursor: default !important;
        }
        /* Keep ability roll buttons working */
        .sheet.actor .ability button.rollable,
        .sheet.actor .ability [data-action="roll"],
        .sheet.actor .stats button.rollable {
            pointer-events: auto !important;
            cursor: pointer !important;
        }
    `,

    currency: `
        /* Lock all currency inputs */
        .sheet.actor input[name="system.currency.cp"],
        .sheet.actor input[name="system.currency.sp"],
        .sheet.actor input[name="system.currency.ep"],
        .sheet.actor input[name="system.currency.gp"],
        .sheet.actor input[name="system.currency.pp"],
        .sheet.actor .currency input,
        .sheet.actor [data-group="currency"] input {
            pointer-events: none !important;
            background: transparent !important;
            border: none !important;
            cursor: default !important;
        }
        /* Hide currency adjustment buttons */
        .sheet.actor .currency .adjustment-button,
        .sheet.actor .currency button[data-action="increment"],
        .sheet.actor .currency button[data-action="decrement"],
        .sheet.actor [data-group="currency"] .adjustment-button,
        .sheet.actor [data-group="currency"] button[data-action="increment"],
        .sheet.actor [data-group="currency"] button[data-action="decrement"] {
            display: none !important;
        }
    `,

    inventory: `
        /* Hide item edit/delete/create controls */
        .item-action.item-edit,
        .item-action.item-delete,
        .item-control.item-edit,
        .item-control.item-delete,
        [data-action="itemCreate"],
        [data-action="addItem"],
        .item-list .item-controls .item-action[data-action="delete"],
        .item-list .item-controls .item-action[data-action="edit"] {
            display: none !important;
        }
        /* Hide quantity adjustment buttons */
        .item-quantity .adjustment-button,
        .item-quantity a[data-action],
        button[data-action="increment"],
        button[data-action="decrement"] {
            display: none !important;
        }
        /* Lock quantity and uses inputs */
        .item-quantity input,
        .item-uses input,
        input[name="system.quantity"],
        input[name="system.uses.value"],
        input[name="system.uses.max"] {
            pointer-events: none !important;
            background: transparent !important;
            border: none !important;
        }
        /* Lock equipped/prepared toggles */
        .item-toggle,
        .item-state-icon {
            pointer-events: none !important;
            cursor: default !important;
        }
    `,

    spellSlots: `
        /* Lock spell slot value and max inputs */
        .sheet.actor input[name^="system.spells.spell"][name$=".value"],
        .sheet.actor input[name^="system.spells.spell"][name$=".max"],
        .sheet.actor .spell-slots input,
        .sheet.actor [data-group="spellSlots"] input {
            pointer-events: none !important;
            background: transparent !important;
            border: none !important;
            cursor: default !important;
        }
        /* Hide spell slot adjustment buttons */
        .sheet.actor .spell-slots .adjustment-button,
        .sheet.actor .spell-slots button[data-action="increment"],
        .sheet.actor .spell-slots button[data-action="decrement"],
        .sheet.actor [data-group="spellSlots"] .adjustment-button {
            display: none !important;
        }
        /* Keep spell casting buttons working */
        .sheet.actor .spell-slots button.rollable,
        .sheet.actor [data-action="castSpell"],
        .sheet.actor [data-action="useSpell"] {
            pointer-events: auto !important;
            cursor: pointer !important;
        }
    `,

    xp: `
        /* Lock XP inputs */
        .sheet.actor input[name="system.details.xp.value"],
        .sheet.actor input[name="system.details.xp.max"],
        .sheet.actor .xp input,
        .sheet.actor [data-group="xp"] input {
            pointer-events: none !important;
            background: transparent !important;
            border: none !important;
            cursor: default !important;
        }
    `,

    deathSaves: `
        /* Lock death save success/failure inputs and pips */
        .sheet.actor input[name="system.attributes.death.success"],
        .sheet.actor input[name="system.attributes.death.failure"],
        .sheet.actor .death-saves input,
        .sheet.actor .death-saves .pips,
        .sheet.actor [data-group="deathSaves"] input {
            pointer-events: none !important;
            background: transparent !important;
            border: none !important;
            cursor: default !important;
        }
        /* Hide death save adjustment buttons */
        .sheet.actor .death-saves .adjustment-button,
        .sheet.actor [data-group="deathSaves"] .adjustment-button {
            display: none !important;
        }
        /* Keep the death save roll button working */
        .sheet.actor .death-saves button.rollable,
        .sheet.actor [data-action="rollDeathSave"],
        .sheet.actor .death-saves [data-action="roll"] {
            pointer-events: auto !important;
            cursor: pointer !important;
        }
    `,

    tokenHud: `
        /* Lock Token HUD attribute bar inputs */
        #token-hud .attribute input,
        #token-hud .attribute.bar1,
        #token-hud .attribute.bar2 {
            pointer-events: none !important;
        }
        #token-hud .attribute input {
            background: rgba(0, 0, 0, 0.5) !important;
        }
    `,

    // refundButton is handled via a hook, not CSS
    refundButton: ``
};

/**
 * Apply CSS enforcement for the current user.
 * Injects a <style> tag with all active lock rules.
 * Also sets up the refund button hook if needed.
 */
export function applyEnforcement() {
    const userId = game.user.id;
    let css = "";

    for (const categoryId of Object.keys(LOCK_CATEGORIES)) {
        if (isLocked(categoryId, userId) && CSS_RULES[categoryId]) {
            css += CSS_RULES[categoryId];
        }
    }

    // Inject combined CSS
    if (css) {
        const style = document.createElement("style");
        style.id = "lawful-sheets-enforcement";
        style.textContent = css;
        document.head.appendChild(style);
        console.log("Lawful Sheets | CSS enforcement applied.");
    }

    // Refund button removal via chat message hook
    if (isLocked("refundButton", userId)) {
        Hooks.on("renderChatMessage", (_message, html) => {
            removeRefundButtons(html);
        });
        // Also remove from any already-rendered messages
        document.querySelectorAll(".chat-message").forEach(msg => {
            removeRefundButtons(msg);
        });
        console.log("Lawful Sheets | Refund button enforcement applied.");
    }
}

/**
 * Remove refund resource buttons from a chat message element.
 * @param {HTMLElement|jQuery} html - The chat message DOM element
 */
function removeRefundButtons(html) {
    // V13 passes a DOM element; handle both DOM and jQuery
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    // Primary target: the data-action button
    root.querySelectorAll('button[data-action="refundResource"]').forEach(btn => btn.remove());

    // Fallback: any button with "Refund" in its text
    root.querySelectorAll("button").forEach(btn => {
        if (btn.textContent.trim().includes("Refund")) btn.remove();
    });
}
