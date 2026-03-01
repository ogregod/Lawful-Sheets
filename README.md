# Lawful Sheets

![Foundry Version](https://img.shields.io/badge/Foundry-v13-orange)
![dnd5e](https://img.shields.io/badge/dnd5e-5.2.x-red)
![Version](https://img.shields.io/badge/Version-1.0.55-blue)
[![Latest Release](https://img.shields.io/github/v/release/ogregod/Lawful-Sheets?display_name=tag)](https://github.com/ogregod/Lawful-Sheets/releases/latest)

**Let's keep these Player Sheets Lawful.**

Lawful Sheets is a Foundry VTT module that enforces strict data integrity on Character Sheets. It combines **CSS enforcement** (disabling UI elements) with **hook-based validation** (client-side rejection of unauthorized changes) to prevent players from modifying sensitive data like HP, currency, inventory, ability scores, spell slots, XP, and more.

If a player opens the browser console and runs `actor.update()` directly, Lawful Sheets will block the change and notify the GM — as long as the module's hooks are active.

Gone are the days of *"oops, I accidentally gave myself 9999 gold"* or *"I thought I had 50 health potions."*

---

## Features

Lawful Sheets doesn't just hide things — it enforces the law at the data level. Every locked field is protected by **two layers**:

1. **CSS Enforcement** — Disables, hides, or locks UI elements so players can't interact with them on the sheet.
2. **Hook Validation** — Hooks into Foundry's `preUpdateActor`, `preUpdateItem`, `preCreateItem`, and `preDeleteItem` to reject unauthorized data changes on the client before they are processed.

### 11 Lock Categories

Each category can be independently configured with global rules and per-user overrides.

| # | Category | What It Protects |
|---|----------|-----------------|
| 1 | **Edit Mode** | Hides the "Edit Mode" toggle and "Configure Sheet" buttons |
| 2 | **Context Menus** | Hides Edit, Delete, and Copy options from right-click menus |
| 3 | **HP & Hit Dice** | Locks current HP, max HP, temp HP, and hit dice. Rolling for rests still works |
| 4 | **Ability Scores** | Locks STR, DEX, CON, INT, WIS, CHA values. Ability check rolls still work |
| 5 | **Currency** | Locks CP, SP, EP, GP, PP fields. Shop modules (Item Piles) can still process transactions |
| 6 | **Inventory** | Blocks adding/deleting items and increasing quantities. Legitimate item usage (potions, charges) still works |
| 7 | **Spell Slots** | Locks spell slot values and maximums. Casting spells still works normally |
| 8 | **Experience Points** | Locks XP so only the GM can award it |
| 9 | **Death Saves** | Locks death save success/failure pips. Rolling death saves still works |
| 10 | **Token HUD** | Locks HP and resource bar editing from the Token HUD overlay |
| 11 | **Refund Button** | Hides the "Refund Resource" button from chat messages |

### The Subtraction Rule

Lawful Sheets follows a simple principle: **Subtraction is fine. Addition is cheating.**

- A player **using a healing potion** (quantity goes down) — Allowed
- A player **spending gold at a shop** (gold goes down) — Allowed
- A player **adding gold to their wallet** (gold goes up) — Blocked
- A player **increasing potion quantity** (quantity goes up) — Blocked
- A player **adding items from nowhere** — Blocked

### Cheat Detection Logging

When Lawful Sheets blocks an unauthorized change, it can **whisper a notification to the GM** with details:

> **Lawful Sheets Alert**
> **PlayerName** attempted to modify `system.currency.gp` on **CharacterName**
> Old: `50` -> Attempted: `9999`

This feature is toggleable in the module settings.

### Module Compatibility

Lawful Sheets is designed to work alongside other modules that make legitimate changes to character data:

- **Item Piles** — Shop transactions go through normally (Item Piles processes transactions via the GM client)
- **dnd5e Rest System** — Short and long rests work as expected
- **Other Modules** — A configurable **Module Whitelist** setting lets GMs add module IDs that should bypass validation

---

## Configuration

Lawful Sheets offers two layers of configuration: **Global Rules** and **Per-User Overrides**.

### Global Settings

Go to `Configure Settings` > `Module Settings` > `Lawful Sheets` to set the baseline rules for your world.

For each of the 11 categories, choose:
- **Everyone Unlocked** — No restrictions for this category.
- **Players Locked (Trusted Free)** — Regular Players are restricted; Trusted Players and GMs are free.
- **Everyone Locked** — All non-GM users are restricted.

Additional settings:
- **Cheat Detection Logging** — Toggle GM whisper notifications when changes are blocked.
- **Module Whitelist** — Comma-separated list of module IDs that bypass validation (default: `item-piles`).

### The Lawful Manager (Per-User Control)

Need to lock down a specific player, or give your most trusted player editing rights?

1. Open the **Token Controls** layer on the sidebar.
2. Click the **Gavel Icon** labeled "Lawful Sheets: Citizen Management".
3. The **Citizen Management** window shows all non-GM users.

For each user, override the global setting per category:
- **Default** — Follows the global setting.
- **Lock** — Forces this category locked for this user, regardless of their role.
- **Unlock** — Exempts this user from this category's lock.

This means you can:
- Lock a Trusted Player who abuses their trust
- Unlock a specific regular Player who has earned editing rights
- Set different rules for every player in your game

---

## Installation

### Manifest URL (Recommended)

1. Open the Foundry VTT Setup screen and click **Add-on Modules**.
2. Click **Install Module**.
3. Paste the following into the "Manifest URL" field:
   ```
   https://raw.githubusercontent.com/ogregod/Lawful-Sheets/main/module.json
   ```
4. Click **Install**.

### Manual Installation

1. Download the latest release from the [Releases page](https://github.com/ogregod/Lawful-Sheets/releases).
2. Extract the zip into your Foundry `modules/` directory.
3. The folder should be named `lawful-sheets`.

### The Forge

Upload the module zip via The Forge's module management interface.

---

## Compatibility

| Requirement | Version |
|------------|---------|
| **Foundry VTT** | v13 (Build 345+) |
| **System** | dnd5e 5.2.x |

Lawful Sheets is designed specifically for the **dnd5e** system. The CSS selectors and data path validation target the dnd5e 5.2 character sheet structure and data model.

---

## How It Works (Technical)

Lawful Sheets uses a dual-layer enforcement approach:

**Layer 1 — CSS Injection (UX)**
On the `ready` hook, the module evaluates which categories are locked for the current user and injects a `<style>` tag that disables relevant UI elements. This prevents casual editing — inputs become non-interactive, buttons are hidden, toggles are disabled. For currency fields specifically, a JavaScript-level input blocker is also applied to catch dynamically rendered elements.

**Layer 2 — Hook Validation (Client-Side)**
Four Foundry document hooks intercept data changes on the client before they are processed:

- `preUpdateActor` — Strips unauthorized field changes from the update object. If a player tries to change their gold AND their name in the same update, the gold change is stripped but the name change goes through.
- `preUpdateItem` — For items on actors: allows quantity/uses decreases (legitimate usage), blocks increases (cheating). Fully blocks changes to uses.max, equipped, and prepared states.
- `preCreateItem` — Blocks players from adding items to their character.
- `preDeleteItem` — Allows deletion of consumed items (quantity 0-1), blocks bulk deletion of item stacks.

GMs (role 3+) always bypass all validation. Changes from whitelisted modules are also allowed through.

---

## File Structure

```
lawful-sheets/
├── module.json           — Module manifest (ESM, V13)
├── scripts/
│   ├── module.mjs        — Entry point, hook wiring
│   ├── settings.mjs      — Settings registration, isLocked() helper
│   ├── enforcer.mjs      — CSS rules and injection
│   ├── validator.mjs     — Hook validation logic
│   └── manager.mjs       — GM management UI (ApplicationV2)
├── templates/
│   └── manager.hbs       — Handlebars template for manager window
└── styles/
    └── lawful-sheets.css — Manager UI styles
```

---

## FAQ

**Q: Can a tech-savvy player bypass this by opening browser dev tools?**
A: They can remove the CSS (Layer 1). The hook validation (Layer 2) stops casual console attempts and provides a meaningful barrier for typical players, but a sufficiently determined user with console access could disable client-side hooks. Lawful Sheets is designed to prevent accidental and casual cheating — not to be a security system against a determined adversary.

**Q: Will this break my shop module?**
A: Most shop modules (like Item Piles) process transactions through the GM client, which automatically bypasses Lawful Sheets. If a module processes on the player's client, add its module ID to the Module Whitelist setting.

**Q: Can players still roll dice and use abilities?**
A: Yes. Lawful Sheets specifically preserves all rollable buttons, casting buttons, rest buttons, and other interactive gameplay elements. It only locks the data fields themselves.

**Q: Does this work with other character sheet modules?**
A: The CSS selectors target the default dnd5e 5.2 sheet. Custom sheet modules may use different CSS classes. The hook validation (Layer 2) works regardless of which sheet module is used, since it operates on the data model, not the UI.

**Q: A player used a potion but it didn't get consumed. What's wrong?**
A: Make sure the Inventory lock category is using the default "Players Locked" setting, not a force-lock override for that user. The subtraction rule allows item consumption (quantity going down). If the issue persists, check that no other modules are interfering with the item's consumption activity.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Credits

- **Author:** [ogregod](https://github.com/ogregod)
- **Module:** [Lawful Sheets on GitHub](https://github.com/ogregod/Lawful-Sheets)
