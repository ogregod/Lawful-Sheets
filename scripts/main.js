/* ==================================================== */
/* 1. THE LAWS (CSS RULES)                              */
/* ==================================================== */
const LAWS = {
    context: `
        /* HIDE EDIT/DELETE/DUPLICATE IN CONTEXT MENUS */
        #context-menu li.context-item:has(.fa-edit),
        #context-menu li.context-item:has(.fa-pen),
        #context-menu li.context-item:has(.fa-pen-to-square),
        #context-menu li.context-item:has(.fa-trash),
        #context-menu li.context-item:has(.fa-trash-can),
        #context-menu li.context-item:has(.fa-copy) { display: none !important; }
    `,
    toggles: `
        /* HIDE EDIT MODE TOGGLES */
        slide-toggle, .mode-slider, .toggle-editing, 
        .sheet-header .configure-sheet, button.configure-sheet { display: none !important; }
    `,
    vitals: `
        /* LOCK VITALS (HP, AC, ETC) */
        .sheet.actor .sidebar, .sheet.actor .vitals, .sheet.actor .stats, .sheet.actor .meter-group { pointer-events: none !important; }
        .sheet.actor .sidebar input, .sheet.actor .vitals input, .sheet.actor .stats input { 
            background: transparent !important; border: none !important; color: inherit !important; cursor: default !important; 
        }
        /* EXCEPTION: ALLOW ROLLS */
        .sheet.actor .sidebar button, .sheet.actor .sidebar .rollable, .sheet.actor .vitals button, .sheet.actor .stats button { 
            pointer-events: auto !important; cursor: pointer !important; 
        }
    `,
    inventory: `
        /* LOCK INVENTORY ADD/EDIT/DELETE */
        .item-action.item-edit, .item-action.item-delete, .item-control.item-edit, .item-control.item-delete,
        .item-quantity .adjustment-button, .item-quantity a[data-action],
        button[data-action="increment"], button[data-action="decrement"] { display: none !important; }
        
        /* LOCK INPUTS */
        .item-quantity input, .item-uses input, input[name="system.quantity"], 
        input[name="system.uses.value"], input[name="system.uses.max"] { 
            pointer-events: none !important; background: transparent !important; border: none !important; 
        }
        .item-toggle, .item-state-icon { pointer-events: none !important; cursor: default !important; }
    `,
    token: `
        /* LOCK TOKEN HUD */
        #token-hud .attribute input, #token-hud .attribute.bar1, #token-hud .attribute.bar2 { pointer-events: none !important; }
        #token-hud .attribute input { background: rgba(0, 0, 0, 0.5) !important; }
    `
};

// Internal ID matches the one in module.json
const MODULE_ID = "lawful-sheets";

/* ==================================================== */
/* 2. ESTABLISH ORDER (SETTINGS)                        */
/* ==================================================== */
Hooks.once('init', () => {
    
    // Helper to register a Law
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
            onChange: () => debouncedReload() 
        });
    };

    registerLaw("lockContext", "Restrict Context Menus");
    registerLaw("lockToggles", "Restrict Edit Mode Toggles");
    registerLaw("lockVitals", "Restrict HP & Stats");
    registerLaw("lockInventory", "Restrict Inventory Management");
    registerLaw("lockToken", "Restrict Token HUD");

    const debouncedReload = foundry.utils.debounce(() => window.location.reload(), 500);
});

/* ==================================================== */
/* 3. ENFORCE THE LAW (LOGIC)                           */
/* ==================================================== */
Hooks.on('ready', () => {
    // 1. IMMUNITY: GMs (4) and Assistants (3) are above the law.
    if (!game.user || game.user.role >= 3) return;

    const isTrusted = game.user.hasRole("TRUSTED");
    let cssPenalties = "";

    // Helper to check if a Law applies to the current citizen
    const isGuilty = (key) => {
        const lawLevel = game.settings.get(MODULE_ID, key);
        if (lawLevel === "none") return false;
        if (lawLevel === "all") return true; // Everyone is locked
        if (lawLevel === "player" && !isTrusted) return true; // Only peasants are locked
        return false;
    };

    // Apply strictures based on settings
    if (isGuilty("lockContext"))   cssPenalties += LAWS.context;
    if (isGuilty("lockToggles"))   cssPenalties += LAWS.toggles;
    if (isGuilty("lockVitals"))    cssPenalties += LAWS.vitals;
    if (isGuilty("lockInventory")) cssPenalties += LAWS.inventory;
    if (isGuilty("lockToken"))     cssPenalties += LAWS.token;

    // Inject the CSS if penalties exist
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
    // Only show to the Judges (GM & Assistant)
    if (!game.user || game.user.role < 3) return;

    const tokenControls = controls.find(c => c.name === "token");
    if (tokenControls) {
        tokenControls.tools.push({
            name: "lawful-config",
            title: "Lawful Sheets Settings",
            icon: "fas fa-scale-balanced", // Scales of Justice icon
            visible: true,
            onClick: () => {
                new SettingsConfig().render(true).activateTab(MODULE_ID);
            },
            button: true
        });
    }
});