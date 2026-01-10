# Lawful Sheets

![Foundry Version](https://img.shields.io/badge/Foundry-v11%20%7C%20v12-orange)
![Version](https://img.shields.io/badge/Version-1.0.2-blue)
[![Latest Release](https://img.shields.io/github/v/release/ogregod/Lawful-Sheets?display_name=tag)](https://github.com/ogregod/Lawful-Sheets/releases/latest)

**Let's keep these Player Sheets Lawful.**

Lawful Sheets is a Foundry VTT module designed to enforce strict data integrity on Character Sheets. It uses surgical CSS injection to prevent players (or specific users) from modifying sensitive data like HP, Inventory quantities, or AC, while still allowing them to roll dice and use items.

Gone are the days of *"oops, I accidentally deleted my sword"* or *"I thought I had 50 arrows."*

## 🔒 Features

Lawful Sheets doesn't just hide the sheet; it locks down specific interactions to keep the game "Read-Only" where it matters, and "Interactive" where it counts.

### 1. Context Menu Filtering
Prevents accidental deletions or modifications via right-click menus.
* **Hides:** "Edit", "Delete", and "Duplicate" options.
* **Keeps:** "View", "Attune", "Equip", and other non-destructive actions.

### 2. Header & Toggle Lockdown
Removes the global "Edit Mode" switches found on many dnd5e sheets.
* Hides the "Edit Mode" slider/toggle.
* Hides the "Configure Sheet" (cogwheel) buttons.

### 3. Vitals Protection (HP, AC, Stats)
Prevents direct editing of the main stats block while ensuring buttons remain clickable.
* **Locked:** HP, AC, Speed, Initiative inputs, and Attribute scores.
* **Unlocked:** Rolling buttons (Saving Throws, Skill Checks, Rests).

### 4. Inventory Control
Ensures equipment lists remain static during play.
* Hides the specific "Edit" and "Delete" icons on item rows.
* Hides Quantity `+` and `-` buttons.
* Locks "Uses" and "Quantity" input fields (preventing typing new numbers).
* Prevents toggling "Equipped" or "Prepared" status.

### 5. Token HUD Restrictions
Prevents players from modifying bar values (HP/Resource) directly from the Token HUD overlay.

---

## ⚙️ Configuration

Lawful Sheets offers two layers of configuration: **Global Laws** and **Individual Exceptions**.

### Global Settings
*Go to `Configure Settings` > `Lawful Sheets` to set the baseline laws for your world.*

For each category (Context Menus, Edit Mode, HP/Stats, Inventory, Token HUD), you can choose:
* **Everyone Unlocked:** The module does nothing for this category.
* **Players Locked:** Regular players are restricted; "Trusted" players and GMs are free.
* **Everyone Locked:** All non-GM users are restricted.

### The Lawful Manager (Per-User Control)
*Need to lock down a specific chaotic player, or give your trusted lieutenant editing rights?*

1.  Open the **Token Controls** layer on the sidebar (the target icon).
2.  Click the **Gavel Icon** (<i class="fas fa-gavel"></i>) labeled "Lawful Sheets: User Management".
3.  This opens the **Citizen Management** window.

Here you can override the global settings for each user:
* **Default:** Follows the global setting.
* **🔒 FORCE LOCK:** Locks this category for this user, regardless of their role.
* **🔓 FORCE UNLOCK:** Grants this user permission to edit this category.

---

## 📸 Screenshots

*(Place screenshots of the Lawful Manager UI and a Locked Sheet here)*

---

## 📦 Installation

To install this module within Foundry VTT:

1.  Open the Foundry VTT Setup screen and click on the **Add-on Modules** tab.
2.  Click **Install Module**.
3.  In the "Manifest URL" field, paste the following link:
    ```
    [https://raw.githubusercontent.com/ogregod/Lawful-Sheets/main/module.json](https://raw.githubusercontent.com/ogregod/Lawful-Sheets/main/module.json)
    ```
4.  Click **Install**.

---

## 🛠️ Compatibility

* **System:** Designed primarily for **dnd5e**.
* **Foundry Version:** Verified for **v11** and **v12**.

## License

This project is licensed under the [MIT License](LICENSE).