/**
 * Lawful Sheets - Manager UI
 * GM-only ApplicationV2 window for managing per-user lock overrides.
 * Accessed via the gavel button on the Token Controls toolbar.
 */

import { LOCK_CATEGORIES, INVENTORY_SUBCATEGORIES } from "./settings.mjs";

const MODULE_ID = "lawful-sheets";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Override value choices shown in each dropdown */
const OVERRIDE_CHOICES = [
    { value: "default",       label: "Default" },
    { value: "force-lock",    label: "Lock" },
    { value: "force-unlock",  label: "Unlock" },
    { value: "force-request", label: "Request" }
];

/** Human-readable labels for global setting values */
const GLOBAL_LABELS = {
    "none":    "Unlocked",
    "player":  "Players Locked",
    "all":     "All Locked",
    "request": "Request Approval"
};

/** Display names and styles for column groups */
const GROUP_META = {
    character: { label: "Character Stats", style: "background:rgba(100,149,237,0.12);" },
    resources: { label: "Resources",       style: "background:rgba(46,139,87,0.12);" },
    inventory: { label: "Inventory",       style: "background:rgba(205,133,63,0.12);" },
    ui:        { label: "Sheet UI",        style: "background:rgba(150,100,200,0.12);" }
};

/**
 * Build a single cell descriptor for a given user and override key.
 */
function buildCell(userId, key, currentValue, globalLabel) {
    const value = currentValue || "default";
    return {
        name: `${userId}.${key}`,
        value,
        globalLabel,
        choices: OVERRIDE_CHOICES.map(c => ({
            ...c,
            selected: c.value === value
        }))
    };
}

/**
 * The Lawful Sheets Citizen Management window.
 * Displays all non-GM users and lets the GM set per-user overrides
 * for each lock category and inventory subcategory.
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
            width: 1050,
            height: 640
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

        // Build category headers
        context.categories = Object.entries(LOCK_CATEGORIES).map(([id, cat]) => {
            const globalValue = game.settings.get(MODULE_ID, cat.key);
            const entry = {
                id,
                name: cat.name,
                globalLabel: GLOBAL_LABELS[globalValue] || globalValue,
                hasSubcategories: !!cat.subcategories
            };

            if (cat.subcategories) {
                entry.subcategories = Object.entries(cat.subcategories).map(([subId, sub]) => {
                    const subGlobal = game.settings.get(MODULE_ID, sub.key);
                    return {
                        id: `${id}.${subId}`,
                        name: sub.name,
                        globalLabel: subGlobal === "inherit"
                            ? `Inherit (${GLOBAL_LABELS[game.settings.get(MODULE_ID, cat.key)] ?? "?"})`
                            : (GLOBAL_LABELS[subGlobal] || subGlobal)
                    };
                });
            }

            return entry;
        });

        // Build flat column list (parent categories + subcategories interleaved)
        // and compute group header spans for the table's top header row.
        context.columns = [];
        const groupSpans = []; // [{ label, style, colspan }]
        let currentGroup = null;

        for (const cat of context.categories) {
            const group = cat.group ?? "ui";
            if (group !== currentGroup) {
                const meta = GROUP_META[group] ?? { label: group, style: "" };
                groupSpans.push({ label: meta.label, style: meta.style, colspan: 0 });
                currentGroup = group;
            }
            groupSpans[groupSpans.length - 1].colspan++;
            context.columns.push({ ...cat, isSub: false });

            if (cat.subcategories) {
                for (const sub of cat.subcategories) {
                    groupSpans[groupSpans.length - 1].colspan++;
                    context.columns.push({ ...sub, isSub: true });
                }
            }
        }

        context.groupSpans = groupSpans;

        // Build user rows
        context.users = game.users
            .filter(u => u.role < 3)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(u => {
                const userOverrides = overrides[u.id] || {};
                const cells = context.columns.map(col => {
                    return buildCell(u.id, col.id, userOverrides[col.id], col.globalLabel);
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
            const categoryKey = key.substring(dotIndex + 1);
            if (!newOverrides[userId]) newOverrides[userId] = {};
            newOverrides[userId][categoryKey] = value;
        }

        await game.settings.set(MODULE_ID, "userOverrides", newOverrides);
        ui.notifications.info("Lawful Sheets: User overrides saved. Reloading...");
        this.close();
        setTimeout(() => window.location.reload(), 500);
    }

    /**
     * Handle the Reset button for a single user.
     */
    static async #onResetUser(event, target) {
        const userId = target.dataset.userId;
        if (!userId) return;
        const selects = this.element.querySelectorAll(`select[name^="${userId}."]`);
        selects.forEach(s => { s.value = "default"; });
        ui.notifications.info("Reset to defaults. Click Save to apply.");
    }
}
