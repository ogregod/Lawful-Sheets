/**
 * Lawful Sheets v1.0.54
 * Enforces strict editing rules for Players with backend validation.
 * CSS enforcement provides the UX layer; preUpdate hooks provide real security.
 *
 * @module lawful-sheets
 * @author ogregod
 */

export const MODULE_ID = "lawful-sheets";

import { registerSettings } from "./settings.mjs";
import { applyEnforcement } from "./enforcer.mjs";
import { registerValidationHooks } from "./validator.mjs";
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

    // Backend validation hooks run for ALL clients
    registerValidationHooks();

    // CSS enforcement only for non-GM users (role < 3)
    if (game.user.role < 3) {
        applyEnforcement();
    }

    console.log(`Lawful Sheets v1.0.54 | Ready. User: ${game.user.name} (Role ${game.user.role})`);
});

/* ============================================================ */
/* SCENE CONTROLS - Gavel button for GM management UI           */
/* ============================================================ */

Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user || game.user.role < 3) return;

    // V13 uses object format for controls
    // controls.tokens is the token control group, .tools is an object
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
