/**
 * Lawful Sheets - Manager UI
 * GM-only ApplicationV2 window for managing per-user lock overrides.
 * Accessed via the gavel button on the Token Controls toolbar.
 */

import { LOCK_CATEGORIES } from "./settings.mjs";

const MODULE_ID = "lawful-sheets";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Lawful Sheets Citizen Management window.
 * Displays all non-GM users and lets the GM set per-user overrides
 * for each of the 11 lock categories.
 */
export class LawfulManager extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @override */
    static DEFAULT_OPTIONS = {
        id: "lawful-manager",
        classes: ["lawful-sheets", "lawful-manager"],
        tag: "div",
        window: {
            frame: true,
            positioned: true,
            title: "Lawful Sheets: Citizen Management",
            icon: "fa-solid fa-gavel",
            minimizable: true,
            resizable: true
        },
        position: {
            width: 950,
            height: 620
        },
        actions: {
            save: LawfulManager.#onSave,
            resetUser: LawfulManager.#onResetUser
        }
    };

    /** @override */
    static PARTS = {
        content: {
            template: `modules/${MODULE_ID}/templates/manager.hbs`,
            scrollable: [".lawful-manager-body"]
        }
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const overrides = game.settings.get(MODULE_ID, "userOverrides") || {};

        // Build category headers with current global setting labels
        const globalLabels = { "none": "Unlocked", "player": "Players Locked", "all": "All Locked" };
        context.categories = Object.entries(LOCK_CATEGORIES).map(([id, cat]) => {
            const globalValue = game.settings.get(MODULE_ID, cat.key);
            return {
                id,
                name: cat.name,
                globalValue,
                globalLabel: globalLabels[globalValue] || globalValue
            };
        });

        // Build user rows with pre-computed selected states for each category
        context.users = game.users
            .filter(u => u.role < 3)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(u => {
                const userOverrides = overrides[u.id] || {};
                const cells = context.categories.map(cat => {
                    const value = userOverrides[cat.id] || "default";
                    return {
                        name: `${u.id}.${cat.id}`,
                        value,
                        globalLabel: cat.globalLabel,
                        isDefault: value === "default",
                        isLock: value === "force-lock",
                        isUnlock: value === "force-unlock"
                    };
                });
                return {
                    id: u.id,
                    name: u.name,
                    role: u.role === 2 ? "Trusted" : "Player",
                    roleClass: u.role === 2 ? "role-trusted" : "role-player",
                    cells
                };
            });

        return context;
    }

    /**
     * Handle the Save button click.
     * Parses form data into the userOverrides structure and saves it.
     */
    static async #onSave(event, target) {
        const form = this.element.querySelector("form");
        if (!form) return;

        const formData = new FormData(form);
        const newOverrides = {};

        for (const [key, value] of formData.entries()) {
            const dotIndex = key.indexOf(".");
            if (dotIndex === -1) continue;
            const userId = key.substring(0, dotIndex);
            const categoryId = key.substring(dotIndex + 1);
            if (!newOverrides[userId]) newOverrides[userId] = {};
            newOverrides[userId][categoryId] = value;
        }

        await game.settings.set(MODULE_ID, "userOverrides", newOverrides);
        ui.notifications.info("Lawful Sheets: User overrides saved. Reloading...");
        this.close();
        setTimeout(() => window.location.reload(), 500);
    }

    /**
     * Handle the Reset button for a single user.
     * Sets all dropdowns for that user back to "default".
     */
    static async #onResetUser(event, target) {
        const userId = target.dataset.userId;
        if (!userId) return;
        const selects = this.element.querySelectorAll(`select[name^="${userId}."]`);
        selects.forEach(s => { s.value = "default"; });
        ui.notifications.info("Reset to defaults. Click Save to apply.");
    }
}
