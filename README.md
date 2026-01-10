# Lawful-Sheets
Lets keep these Player Sheets Lawful. 
Hooks.on('ready', () => {
    // 1. SAFETY CHECK: GMs must have full access.
    if (!game.user || game.user.isGM) return;

    const style = document.createElement('style');
    style.id = "global-dnd5e-lockdown";
    style.innerHTML = `
      /* ==================================================== */
      /* SECTION 1: SURGICAL CONTEXT MENU FILTERING           */
      /* ==================================================== */
      /* We DO NOT hide the menu itself. We hide specific OPTIONS. */

      /* Target: Standard Right-Click Menu (#context-menu) 
         and the "Three Dots" Dropdowns (.context-items) */

      /* 1. HIDE EDIT OPTIONS */
      /* Finds any menu item containing an Edit/Pen icon */
      #context-menu li.context-item:has(.fa-edit),
      #context-menu li.context-item:has(.fa-pen),
      #context-menu li.context-item:has(.fa-pen-to-square),
      .context-menu li:has(.fa-edit),
      .context-menu li:has(.fa-pen),
      .context-menu li:has(.fa-pen-to-square) {
          display: none !important;
      }

      /* 2. HIDE DELETE OPTIONS */
      /* Finds any menu item containing a Trash icon */
      #context-menu li.context-item:has(.fa-trash),
      #context-menu li.context-item:has(.fa-trash-can),
      .context-menu li:has(.fa-trash),
      .context-menu li:has(.fa-trash-can) {
          display: none !important;
      }

      /* 3. HIDE DUPLICATE OPTIONS */
      #context-menu li.context-item:has(.fa-copy),
      .context-menu li:has(.fa-copy) {
          display: none !important;
      }

      /* Note: "View Item", "Attune", "Equip" remain visible 
         because they don't have the icons listed above. */


      /* ==================================================== */
      /* SECTION 2: GLOBAL EDIT TOGGLES (Header)              */
      /* ==================================================== */
      /* We still hide the global "Edit Mode" switch at the top */
      
      slide-toggle,
      .mode-slider,
      .toggle-editing,
      .sheet-header .configure-sheet,
      button.configure-sheet {
          display: none !important;
      }


      /* ==================================================== */
      /* SECTION 3: SIDEBAR / VITALS (Container Lock)         */
      /* ==================================================== */
      /* Keeps HP, AC, Speed locked by shielding the container */

      .sheet.actor .sidebar,
      .sheet.actor .vitals,
      .sheet.actor .stats, 
      .sheet.actor .meter-group {
          pointer-events: none !important;
      }

      /* Visual Cleanup */
      .sheet.actor .sidebar input,
      .sheet.actor .vitals input,
      .sheet.actor .stats input {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          color: inherit !important;
          cursor: default !important;
      }

      /* EXCEPTION: Allow clicking Buttons (Rolls/Rests) */
      .sheet.actor .sidebar button,
      .sheet.actor .sidebar .rollable,
      .sheet.actor .vitals button,
      .sheet.actor .stats button {
          pointer-events: auto !important;
          cursor: pointer !important;
      }


      /* ==================================================== */
      /* SECTION 4: INVENTORY & FEATURES                      */
      /* ==================================================== */

      /* Hide the dedicated "Edit" and "Delete" buttons on the row itself 
         (The ones that appear on hover, NOT the three dots) */
      .item-action.item-edit,
      .item-action.item-delete,
      .item-control.item-edit,
      .item-control.item-delete {
          display: none !important;
      }

      /* Hide Quantity +/- Buttons */
      .item-quantity .adjustment-button,
      .item-quantity a[data-action],
      button[data-action="increment"],
      button[data-action="decrement"] {
          display: none !important;
      }

      /* Lock Quantity & Uses Inputs */
      .item-quantity input,
      .item-uses input,
      input[name="system.quantity"],
      input[name="system.uses.value"],
      input[name="system.uses.max"] {
          pointer-events: none !important;
          background: transparent !important;
          border: none !important;
      }

      /* Lock Toggles (Equipped/Prepared Icons) */
      .item-toggle,
      .item-state-icon {
          pointer-events: none !important;
          cursor: default !important;
      }


      /* ==================================================== */
      /* SECTION 5: TOKEN HUD (Right-Click Overlay)           */
      /* ==================================================== */
      
      #token-hud .attribute input {
          pointer-events: none !important;
          background: rgba(0, 0, 0, 0.5) !important;
      }
      #token-hud .attribute.bar1, 
      #token-hud .attribute.bar2 {
          pointer-events: none !important;
      }
    `;

    document.head.appendChild(style);
    console.log("Global Lockdown: Context Menus Restored (Edit/Delete options hidden).");
});