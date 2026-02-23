/**
 * World Scripter:
 * 1. Handle "GM Requested Rest" with Security Bypass
 * 2. TOTAL VISION & SELECTION LOCK (Zero-Flicker V13)
 * - Prevents "Ghost Actors" in Levels module.
 * - Keeps vision active even in Measurement/Template mode.
 *
 * NOTE: "Refund Resource" button removal has been moved to the Lawful Sheets module.
 */

Hooks.once("ready", () => {
    console.log("World Scripter | Initializing Combined Secure Handler...");

    // --- 1. THE ZERO-FLICKER LOCK ---
    // Intercepts the "unselect" command at the source so it never happens.
    const originalRelease = Token.prototype.release;
    Token.prototype.release = function(options) {
        if (!game.user.isGM && this.actor?.id === game.user.character?.id) {
            return false; // Veto the release
        }
        return originalRelease.call(this, options);
    };

    // Forces vision to remain tethered to the character token even in other tool modes
    Hooks.on("initializeVisionSources", () => {
        if (game.user.isGM) return;
        const charToken = canvas.tokens.placeables.find(t => t.actor?.id === game.user.character?.id);
        if (charToken) {
            charToken.vision.active = true;
        }
    });

    // Blocks the "Clear Selection" command when switching layers or tools
    const originalReleaseAll = canvas.tokens.constructor.prototype.releaseAll;
    canvas.tokens.constructor.prototype.releaseAll = function(options) {
        if (!game.user.isGM && game.user.character) return [];
        return originalReleaseAll.call(this, options);
    };

    // --- 2. GM REST REQUEST LOGIC ---
    Hooks.on("renderChatMessage", (message, html, data) => {

        // --- LISTEN FOR REST REQUESTS (WITH BYPASS) ---
        html.find('.custom-rest-btn').click(async (ev) => {
            ev.preventDefault();
            const btn = $(ev.currentTarget);
            const restType = btn.data("rest-type");
            const newDay = btn.data("new-day");

            // Identify Actor (Prioritize controlled, fallback to assigned)
            const targetActor = canvas.tokens.controlled[0]?.actor || game.user.character;

            if (!targetActor) {
                return ui.notifications.warn("Please select your token to rest.");
            }

            // --- THE SECURITY BYPASS ---
            const originalGet = game.settings.get;
            game.settings.get = (module, key) => {
                if (module === "dnd5e" && key === "allowRest") return true;
                return originalGet.call(game.settings, module, key);
            };

            try {
                if (restType === "long") {
                    await targetActor.longRest({ dialog: true, newDay: newDay });
                } else {
                    await targetActor.shortRest({ dialog: true });
                }
            } catch (err) {
                console.error("Rest Error:", err);
            } finally {
                // --- RESTORE SECURITY ---
                game.settings.get = originalGet;
            }
        });
    });
});
