/* ==================================================== */
/* 1. THE LAWS (CSS RULES)                              */
/* ==================================================== */
const LAWS = {
    context: `
        #context-menu li.context-item:has(.fa-edit),
        #context-menu li.context-item:has(.fa-pen),
        #context-menu li.context-item:has(.fa-pen-to-square),
        #context-menu li.context-item:has(.fa-trash),
        #context-menu li.context-item:has(.fa-trash-can),
        #context-menu li.context-item:has(.fa-copy) { display: none !important; }
    `,
    toggles: `
        slide-toggle, .mode-slider, .toggle-editing, 
        .sheet-header .configure-sheet, button.configure-sheet { display: none !important; }
    `,
    vitals: `
        .sheet.actor .sidebar, .sheet.actor .vitals, .sheet.actor .stats, .sheet.actor .meter-group { pointer-events: none !important; }
        .sheet.actor .sidebar input, .sheet.actor .vitals input, .sheet.actor .stats input { 
            background: transparent !important; border: none !important; color: inherit !important; cursor: default !important; 
        }
        .sheet.actor .sidebar button, .sheet.actor .sidebar .rollable, .sheet.actor .vitals button, .sheet.actor .stats button { 
            pointer-events: auto !important; cursor: pointer !important; 
        }
    `,
    inventory: `
        .item-action.item-edit, .item-action.item-delete, .item-control.item-edit, .item-control.item-delete,
        .item-quantity .adjustment-button, .item-quantity a[data-action],
        button[data-action="increment"], button[data-action="decrement"] { display: none !important; }
        .item-quantity input, .item-uses input, input[name="system.quantity"], 
        input[name="system.uses.value"], input[name="system.uses.max"] { 
            pointer-events: none !important; background: transparent !important; border: none !important; 
        }
        .item-toggle, .item-state-icon { pointer-events: none !important; cursor: default !important; }
    `,
    token: `
        #token-hud .attribute input, #token-hud .attribute.bar1, #token-hud .attribute.bar2 { pointer-events: none !important; }
        #token-hud .attribute input { background: rgba(0, 0, 0, 0.5) !important; }
    `
};

const MODULE_ID = "lawful-sheets";

/* ==================================================== */
/* 2. THE MANAGER APP (Custom UI)                       */
/* ==================================================== */
class LawfulManager extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "lawful-manager",
            title: "Lawful Sheets: Citizen Management",
            template: `modules/${MODULE_ID}/templates/manager.html`,
            width: 800,
            height: "auto",
            closeOnSubmit: true
        });
    }

    render() {
        const overrides = game.settings.get(MODULE_ID, "userOverrides") || {};
        const globalSettings = {
            context: game.settings.get(MODULE_ID, "lockContext"),
            toggles: game.settings.get(MODULE_ID, "lockToggles"),
            vitals: game.settings.get(MODULE_ID, "lockVitals"),
            inventory: game.settings.get(MODULE_ID, "lockInventory"),
            token: game.settings.get(MODULE_ID, "lockToken"),
        };

        let rows = "";
        
        game.users.filter(u => u.role < 3).forEach(user => {
            const userSettings = overrides[user.id] || {};
            
            const makeSelect = (key) => {
                const val = userSettings[key] || "default";
                return `
                <select name="${user.id}.${key}" style="font-family: monospace;">
                    <option value="default" ${val === 'default' ? 'selected' : ''}>Default (${globalSettings[key]})</option>
                    <option value="force-lock" ${val === 'force-lock' ? 'selected' : ''}>🔒 FORCE LOCK</option>
                    <option value="force-unlock" ${val === 'force-unlock' ? 'selected' : ''}>🔓 FORCE UNLOCK</option>
                </select>`;
            };

            rows += `
            <tr style="border-bottom: 1px solid rgba(0,0,0,0.2);">
                <td style="padding: 5px; font-weight: bold;">${user.name} <span style="font-size:0.8em; color: #666;">(${user.role === 2 ? 'Trusted' : 'Player'})</span></td>
                <td>${makeSelect("context")}</td>
                <td>${makeSelect("toggles")}</td>
                <td>${makeSelect("vitals")}</td>
                <td>${makeSelect("inventory")}</td>
                <td>${makeSelect("token")}</td>
            </tr>`;
        });

        const content = `
        <form style="padding: 10px;">
            <p style="margin-bottom: 10px;">Configure exceptions here. <b>"Default"</b> uses the Global Rules set in the standard Settings menu.</p>
            <table style="width: 100%; text-align: left; border-spacing: 0 5px;">
                <thead>
                    <tr style="background: rgba(0,0,0,0.1);">
                        <th style="padding: 5px;">User</th>
                        <th>Context Menu</th>
                        <th>Edit Mode</th>
                        <th>HP/Stats</th>
                        <th>Inventory</th>
                        <th>Token HUD</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <footer class="sheet-footer flexrow" style="margin-top: 15px;">
                <button type="submit" name="submit"><i class="fas fa-save"></i> Save Laws</button>
            </footer>
        </form>
        `;

        this._element = $(content);
        this._element.submit(e => {
            e.preventDefault();
            this._onSubmit(e);
        });
        
        super.render(true);
    }

    async _updateObject(event, formData) {
        const newOverrides = {};
        for (let [key, value] of Object.entries(formData)) {
            const [userId, rule] = key.split(".");
            if (!newOverrides[userId]) newOverrides[userId] = {};
            newOverrides[userId][rule] = value;
        }
        await game.settings.set(MODULE_ID, "userOverrides", newOverrides);
        ui.notifications.info("Lawful Sheets: Individual exceptions updated.");
        setTimeout(() => window.location.reload(), 500);
    }
}

/* ==================================================== */
/* 3. SETTINGS REGISTRATION                             */
/* ==================================================== */
Hooks.once('init', () => {
    game.settings.register(MODULE_ID, "userOverrides", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    const registerGlobal = (key, name) => {
        game.settings.register(MODULE_ID, key, {
            name: `Global: ${name}`,
            hint: "Default behavior for Roles. Can be overridden per-user in the Token Controls menu.",
            scope: "world",
            config: true,
            type: String,
            choices: {
                "none": "Everyone Unlocked",
                "player": "Players Locked (Trusted Free)",
                "all": "Everyone Locked"
            },
            default: "player",
            onChange: () => foundry.utils.debounce(() => window.location.reload(), 500)()
        });
    };

    registerGlobal("lockContext", "Context Menus");
    registerGlobal("lockToggles", "Edit Mode");
    registerGlobal("lockVitals", "HP & Stats");
    registerGlobal("lockInventory", "Inventory");
    registerGlobal("lockToken", "Token HUD");
});

/* ==================================================== */
/* 4. THE ENFORCER (LOGIC)                              */
/* ==================================================== */
Hooks.on('ready', () => {
    if (!game.user || game.user.role >= 3) return;

    const overrides = game.settings.get(MODULE_ID, "userOverrides");
    const myOverrides = overrides[game.user.id] || {};
    const isTrusted = game.user.hasRole("TRUSTED");
    
    let cssPenalties = "";

    const isGuilty = (ruleKey, globalKey) => {
        const userRule = myOverrides[ruleKey];
        if (userRule === "force-lock") return true;
        if (userRule === "force-unlock") return false;
        
        const globalRule = game.settings.get(MODULE_ID, globalKey);
        if (globalRule === "all") return true;
        if (globalRule === "player" && !isTrusted) return true;
        
        return false;
    };

    if (isGuilty("context", "lockContext"))     cssPenalties += LAWS.context;
    if (isGuilty("toggles", "lockToggles"))     cssPenalties += LAWS.toggles;
    if (isGuilty("vitals", "lockVitals"))       cssPenalties += LAWS.vitals;
    if (isGuilty("inventory", "lockInventory")) cssPenalties += LAWS.inventory;
    if (isGuilty("token", "lockToken"))         cssPenalties += LAWS.token;

    if (cssPenalties) {
        const style = document.createElement('style');
        style.id = "lawful-sheets-enforcement";
        style.innerHTML = cssPenalties;
        document.head.appendChild(style);
        console.log("Lawful Sheets: Restrictions applied.");
    }
});

/* ==================================================== */
/* 5. SIDEBAR BUTTON (FIXED)                            */
/* ==================================================== */
Hooks.on('getSceneControlButtons', (controls) => {
    if (!game.user || game.user.role < 3) return;

    // === THE FIX IS HERE ===
    // Sometimes 'controls' is the array, sometimes it is the Wrapper Object.
    // We check both possibilities to prevent the crash.
    const controlList = Array.isArray(controls) ? controls : controls.controls;

    // Double check that we actually found the list before searching
    if (!controlList) return; 

    const tokenControls = controlList.find(c => c.name === "token");
    if (tokenControls) {
        tokenControls.tools.push({
            name: "lawful-config",
            title: "Lawful Sheets: User Management",
            icon: "fas fa-gavel", 
            visible: true,
            onClick: () => {
                new LawfulManager().render(true);
            },
            button: true
        });
    }
});