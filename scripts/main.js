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
/* 2. ESTABLISH ORDER (SETTINGS)                        */
/* ==================================================== */
Hooks.once('init', () => {
    const registerLaw = (key, name) => {
        game.settings.register(MODULE_ID, key, {
            name: name,
            hint: "Select which rank allows editing.",
            scope: "world",
            config: true,
            type: String,
            choices: {
                "none": "Lawless (Unlocked for Everyone)",
                "player": "Standard Players Locked (Trusted Unlocked)",
                "all": "Total Lockdown (Players & Trusted Locked)"
            },
            default: "player",
            onChange: () => foundry.utils.debounce(() => window.location.reload(), 500)()
        });
    };

    registerLaw("lockContext", "Restrict Context Menus");
    registerLaw("lockToggles", "Restrict Edit Mode Toggles");
    registerLaw("lockVitals", "Restrict HP & Stats");
    registerLaw("lockInventory", "Restrict Inventory Management");
    registerLaw("lockToken", "Restrict Token HUD");
});

/* ==================================================== */
/* 3. ENFORCE THE LAW (LOGIC)                           */
/* ==================================================== */
Hooks.on('ready', () => {
    // 1. GMs (4) and Assistants (3) are immune
    if (!game.user || game.user.role >= 3) return;

    const isTrusted = game.user.hasRole("TRUSTED");
    let cssPenalties = "";

    const isGuilty = (key) => {
        const lawLevel = game.settings.get(MODULE_ID, key);
        if (lawLevel === "none") return false;
        if (lawLevel === "all") return true;
        if (lawLevel === "player" && !isTrusted) return true;
        return false;
    };

    if (isGuilty("lockContext"))   cssPenalties += LAWS.context;
    if (isGuilty("lockToggles"))   cssPenalties += LAWS.toggles;
    if (isGuilty("lockVitals"))    cssPenalties += LAWS.vitals;
    if (isGuilty("lockInventory")) cssPenalties += LAWS.inventory;
    if (isGuilty("lockToken"))     cssPenalties += LAWS.token;

    if (cssPenalties) {
        const style = document.createElement('style');
        style.id = "lawful-sheets-enforcement";
        style.innerHTML = cssPenalties;
        document.head.appendChild(style);
        console.log("Lawful Sheets: Order restored.");
    }
});

/* ==================================================== */
/* 4. THE GAVEL (SIDEBAR BUTTON)                        */
/* ==================================================== */
Hooks.on('getSceneControlButtons', (controls) => {
    // Debug log to ensure this code is actually running
    // If you don't see this in F12 console, the file is cached or not loading
    console.log("Lawful Sheets: Checking button permissions...");

    if (!game.user || game.user.role < 3) return;

    const tokenControls = controls.find(c => c.name === "token");
    if (tokenControls) {
        tokenControls.tools.push({
            name: "lawful-config",
            title: "Lawful Sheets Settings",
            icon: "fas fa-balance-scale", // Safe icon for all versions
            visible: true,
            onClick: () => {
                // Opens the standard Settings Config window
                new SettingsConfig().render(true);
            },
            button: true
        });
        console.log("Lawful Sheets: Button added to Token Controls.");
    }
});