# Bald Client in-game integration

The launcher-managed client mod currently targets Fabric 1.21.11. The launcher updates or removes only `bald-launcher-client.jar` in the selected profile's `mods` directory. It does not remove other mods or profile data.

## Independent settings

- **Enable Bald Client mod** is the master switch for supported launches. When off, the launcher removes the managed JAR before starting the selected profile. It cannot unload a mod from a Minecraft process that is already running.
- **Custom menus** replaces the title and pause screens with the Bald layouts. This does not disable the mod, performance HUD, or in-game button.
- **Performance button** controls the visible Performance & UI shortcut in the Bald menus or, when custom menus are off, the added button on vanilla menus. Right Alt remains a keyboard route to the settings screen.
- **In-game button** independently controls the draggable Bald HUD shortcut and its click target.
- **Performance HUD** is the master switch for metric widgets. Each metric has its own persisted preference; disabling the master suppresses all metric rendering and click sampling.

The master checkbox is a launcher-wide preference applied to whichever supported profile is launched; only that selected profile's managed JAR is reconciled on launch. The launcher writes a temporary runtime configuration for supported launches. In-game menu/button/HUD-master preferences are reconciled with the launcher's previous values so launcher changes take effect on the next launch while unchanged launcher values allow in-game choices to persist. Individual metric and layout choices remain in `config/baldlauncher-client.json`. Missing fields use safe defaults; invalid values are reported and replaced with safe defaults, while an unreadable runtime document or missing required integration data disables the integration for that launch.

## Mod compatibility

The title and pause mixins run at the end of screen initialization and do not cancel vanilla initialization. If another mod has already changed the active screen during initialization, Bald leaves that replacement alone. With custom menus enabled, the completed vanilla screen is otherwise replaced; controls inserted by other mods are not transferred into the replacement screen. Mods that depend on those controls or on the concrete vanilla screen can therefore conflict. Disable custom menus to keep the vanilla screen and its modifications. The optional performance shortcut checks existing clickable widgets and uses an unoccupied corner; if none is available, the button is omitted rather than overlapping another control.

Mixins remain required and narrowly target the vanilla title, pause, and mouse handling paths. This is not a claim of universal mod compatibility. Actual compatibility must be checked in the target Minecraft instance and mod list.

## Rendering

Menu glass uses a single cached framebuffer snapshot per screen initialization/resize and falls back to dark native panels if capture is unavailable. No performance improvement is claimed without in-game benchmarks.
