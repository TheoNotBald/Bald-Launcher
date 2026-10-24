# Minecraft Performance and Feather-Inspired Feature Audit

**Reviewed:** 14 October 2026
**Scope:** Representative source-backed survey of Minecraft Java launcher/game performance practices, a read-only audit of the current Bald Launcher source, and a comparison with the Feather-style features named by the user.

## Executive summary

Bald Launcher already has meaningful performance-related infrastructure: Minecraft-aware Java major selection, automatic heap sizing, renderer choices and version-filtered mod downloads, an opt-in isolated Fabric/Sodium profile, Windows process telemetry, and a PresentMon gameplay capture flow. The isolated profile copies the original visual settings and assets without editing the source profile's `options.txt`; optimization mods are not required for the launcher itself to work.

The strongest confirmed issue found in the audit—the **Sodium + Vulkan recommendation bundle contradicting its exclusion list**—has been corrected in the current working tree. Bundle selection is now constrained by the version/loader compatibility allowlist, required dependencies and known conflicts are checked before install, SHA-1 and SHA-512 are verified, and files are staged before a rollback-capable commit.

The benchmark's shared test-condition signature now includes the exact Java runtime and heap/JVM configuration; a separate per-role configuration signature records the launched loader, renderer, and enabled mod JAR hashes. This allows the baseline and optimized profile to differ as the measured treatment while requiring each role's repeated runs to stay consistent.

The launcher now includes a Minecraft-side Bald main/pause menu integration for Fabric 1.21.11. The redesigned main menu emphasizes Singleplayer and Multiplayer, with secondary actions for cosmetics, performance, accounts, and options. In-world, a compact Bald button and independently optional FPS/frame-time/ping/memory HUD open a small settings panel; a configurable Controls keybind can open it as well. The menu, button, and HUD settings are independent, with the custom menu and button on by default and the HUD off. The in-game Cosmetics and account entries hand off to the existing launcher UI and restart flow. The support boundary remains one exact Minecraft/loader target. The Performance page is a read-only placeholder, not a live per-mod performance control panel. The Performance Center's recommendations are rules of thumb, not bottleneck diagnosis; one recommendation can increase the heap based only on its configured value.

No actual FPS gain can be concluded from this audit. The earlier project validation history records no real Minecraft before/after benchmark, and the last recorded environment probe lacked both a running client and PresentMon.

## Priority findings

### P1 — Renderer bundle compatibility (fixed in current working tree)

The `26.2:fabric:sodium-native-vulkan` compatibility entry excludes several renderer companions also named in the static bundle. The current working tree marks entries outside the version/loader allowlist unavailable, rejects excluded/unknown IDs at install time, resolves required dependencies for the exact game/loader, checks SHA-1 and SHA-512, rejects known conflicts among planned and enabled Modrinth mods, and stages downloads before committing them. If a commit move fails, already-moved files are removed; state metadata is changed only after all files commit.

**Remaining limitation:** Conflicts in manually added or non-Modrinth mods with no version metadata cannot be completely inferred from launcher state. Use a clean/isolated profile for the strongest guarantee.

**Validation boundary:** Unit tests cover allowlist/exclusion validation, incompatible project metadata, and staged-file commit/rollback. The Electron IPC handler's remote Modrinth resolution and full end-to-end rollback path still need integration-level validation.

Evidence: [`main.js` renderer compatibility data](./main.js#L220), [`main.js` shared renderer bundle policy](./main.js#L390), [`main.js` preview](./main.js#L4760), [`main.js` bundle install handler](./main.js#L4860), and [`performance-runtime.test.js` bundle and conflict helper coverage](./tests/performance-runtime.test.js#L126).

### P1 — Benchmark identity (strengthened in current working tree)

The shared test-condition signature now includes machine/hardware identity, source profile, scene label, Minecraft version, Java major and exact executable/runtime version, JVM-memory/argument configuration, shader state, and settings/assets hashes. A separate configuration fingerprint records the launched profile's loader/version, renderer, and active mod JAR names and hashes. Repeated runs must keep each role's configuration stable, while baseline and optimized configurations may differ as the treatment being measured. Redacted effective launch arguments are also stored with each run. Automatic heap sizing no longer selects a larger heap merely because a profile is the managed optimization profile, avoiding an uncontrolled heap-size difference in its vanilla comparison.

**Remaining limitations:** Scene/world is still a user-entered label rather than a verified world/coordinate; installed GPU inventory is not the active adapter, and actual adapter identity is not part of the signature. User-attested equality cannot prove identical play conditions.

Evidence: [`main.js` active-mod fingerprint and benchmark context](./main.js#L9650) and [`performance-runtime.js` benchmark signature fields](./src/shared/performance-runtime.js#L285).

### P2 — Bottleneck diagnostics do not yet distinguish CPU-, GPU-, memory-, or thermal-limited play

The Performance Center reports process CPU and memory plus, on Windows, the process-specific 3D-engine counters and the Windows adapter LUID/physical index those counters belong to. It also opens the supported Windows Advanced Graphics Settings page and reads the per-app preference for the exact resolved Java executable; it does not write GPU settings itself. Installed GPU names remain separate from process-observed adapter IDs. VRAM, temperatures, clock rates, power limits, per-core/per-thread utilization, and a sustained gameplay trace remain unavailable. GPU counter and preference availability varies by Windows system.

**Impact:** These facts can show which Windows GPU adapter identifier has an active Minecraft 3D engine and whether Windows has a per-app preference recorded for the exact Java executable, but they cannot reliably explain why FPS is low. A low aggregate CPU reading, for example, does not rule out one saturated Minecraft main thread. The adapter LUID is an OS identity, not a marketing name; the user should correlate it with Task Manager/Windows Settings. The saved preference is not proof it took effect, so verify again after game restart.

**Remaining work:** Preserve the honest “unknown” labels. Add optional time-series sampling and clearly separated observed/estimated values where reliable Windows counters exist; map adapter LUIDs to human-readable GPU names if a reliable Windows API can be used, and add IPC integration coverage. Do not imply the launcher controls GPU selection or that the preference alone proves which adapter rendered a frame.

Evidence: [`main.js` Windows process/GPU query](./main.js#L9513), [`main.js` live snapshot](./main.js#L9699), and [`bald_launcher_v7.html` Performance Center](./bald_launcher_v7.html#L1093).

### P2 — RAM advice is a configured-value heuristic, not measured memory pressure

`refreshPerformanceCenter()` recommends increasing RAM whenever `profile.memoryMax < 4` and offers an Apply button. It does not inspect Java heap occupancy, GC pauses, allocation failures, current system pressure, or observed workload. Applying it sets the profile maximum to at least 4 GB. Separately, automatic sizing uses total/available RAM with fixed workload caps.

**Impact:** The recommendation may increase memory use without evidence that the game needs it, and can be a poor fit for a low-memory machine. More heap is not a general average-FPS optimization.

**Recommended correction:** Remove the automatic “increase RAM” action unless observed heap/GC pressure supports it. If those measurements are unavailable, explain that low heap can cause allocation failures or loading problems, but ask the user to inspect a representative workload before changing it. Keep the existing automatic reserve logic labeled as a conservative estimate.

Evidence: [`bald_launcher_v7.html` RAM recommendation rule and Apply control](./bald_launcher_v7.html#L4215) and [`performance-runtime.js` automatic heap estimate](./src/shared/performance-runtime.js#L21).

### P2 — JVM profile wording overstates what the default and ZGC selections do

The profile settings UI labels the default JVM profile “Tuned G1GC,” while the launch helper returns no additional JVM arguments for `default`; Java's own defaults are used. The settings page correctly calls these “Java defaults,” but the profile-detail selector does not. “Ultra low-stutter (ZGC)” also reads as a promised outcome even though collector effects depend on runtime and workload.

**Impact:** The UI can imply a launcher tuning change that is not made, or imply a stutter improvement that has not been measured.

**Recommended correction:** Use consistent labels (“Java defaults” and “Experimental ZGC”) and state that collector selection is not a guaranteed FPS or frame-time improvement. Compare it using the corrected benchmark signature before recommending it.

Evidence: [`bald_launcher_v7.html` profile-detail JVM labels](./bald_launcher_v7.html#L1164), [`bald_launcher_v7.html` settings JVM labels](./bald_launcher_v7.html#L1261), and [`performance-runtime.js` JVM argument helper](./src/shared/performance-runtime.js#L35).

### P2 — The ordinary renderer-bundle path is not the same as the isolated optimization path

The opt-in managed Sodium workflow creates a separate profile and copies settings/assets. The separate renderer-bundle handler installs chosen mods into the selected profile's game directory. That is a user-confirmed action, not an automatic install, but it is not isolated from that profile's existing mods/worlds.

**Impact:** Users can choose a renderer bundle in a profile they intended to keep vanilla or clean. This is less safe than the isolated-profile workflow and can produce interactions with pre-existing mods.

**Recommended correction:** Make the renderer bundle action create/use an explicit duplicate or managed child profile by default, or clearly label the existing-profile path as modifying that profile and require confirmation. Preserve the original profile as a rollback point.

Evidence: [`main.js` isolated profile creation](./main.js#L3469) versus [`main.js` direct bundle installation](./main.js#L4828).

### P2 — Bald in-game UI support is version-limited; live performance optimizations remain absent

The launcher now provides a Minecraft client-side Bald main/pause menu for Fabric 1.21.11, with a background blur, current authenticated skin-face preview, a compact secondary navigation, Cosmetics handoff, and account-switch request that prompts and restarts into the selected launcher account. In-world, the optional Bald button opens a compact settings panel; the separate HUD displays FPS, estimated frame time (1000/FPS), player ping when available, and JVM memory use. Its shortcut can be remapped in Minecraft Controls. The custom menus and button default on; the HUD defaults off. Button/HUD choices can also be changed in-game and persist with the profile. The support boundary is exact: other versions and loaders launch unchanged. The Performance screen does not control installed mods; verified performance optimizations remain independently managed from the launcher. Nor does the launcher itself expose game settings such as render distance, simulation distance, particles, or FPS cap.

**Validation boundary:** The Fabric client mod compiles and focused tests cover target gating, toggle defaults, the loopback bridge, and managed mod installation. The client mod bundles the Fabric API dependency required for the in-game HUD/keybinding. The redesigned screens, in-game toggle persistence, and HUD still need a live Minecraft smoke test. The mod is installed only into a supported profile's own `mods` directory; do not assume it will operate in other profiles.

**Impact / constraint:** Broader compatibility requires per-version and per-loader builds/tests. The prior requirement explicitly says never write modified Minecraft video settings, so graphics-setting automation should remain out of scope unless that requirement changes. Safe next steps are a real-game test of the supported target, then UI controls for verified compatible mod toggles—not silent edits to `options.txt`.

### P2 — No validated FPS uplift or machine-specific profile recommendation

The repository has a PresentMon capture flow with warm-up and repeat-run comparisons, but the checked project history contains no real baseline-versus-optimized Minecraft measurements. The bundled optimization list is a candidate configuration, not proof that it is faster on a given machine or scene. A mod can help one bottleneck and do little or harm elsewhere.

**Recommended correction:** Run alternating repeated trials on the same world snapshot and route, compare medians and ranges for average FPS and frame-time lows, and separately measure startup/world-generation workloads. Report the actual runtime, GPU used, settings, mods, and version. Do not advertise a numerical gain until those runs exist.

## What the launcher already does

| Area | Current implementation | Audit assessment |
|---|---|---|
| Java selection | Maps Minecraft versions to a required Java major and resolves a Java executable for launch. | Useful compatibility baseline; exact runtime build/distribution is not part of benchmark equality. |
| Heap | Optional automatic maximum based on total and available system RAM; otherwise user-selected max. | A conservative sizing estimate, not an FPS tuning system. |
| JVM flags | Default uses Java defaults; optional ZGC on Java 21+; custom arguments supported. | No arbitrary “magic flag” bundle by default, which is appropriate. UI wording needs correction. |
| Optimization profile | Explicit opt-in managed Fabric/Sodium profile for eligible clean Vanilla/Fabric/Quilt sources; exact game/loader releases, dependency trees, metadata and checksums are checked; rollback/fallback exists. | Good foundation; distinct from the generic renderer bundle path. |
| Settings preservation | Copies `options.txt`, resource packs, shader packs, and relevant Iris config into the isolated profile. | Preserves the starting configuration; no automatic graphics-option tuning. |
| In-game UI | Fabric 1.21.11 client mod replaces title/pause menus, adds a secondary navigation layout, optional Bald HUD button, configurable settings key, and opt-in performance HUD; cosmetics/account actions use an authenticated loopback bridge. | Account changes restart the game; HUD frame time is estimated from FPS; the Performance screen is not a live tweak panel; other versions/loaders remain unchanged. |
| Renderer choices | Sodium, Vulkan-based options for selected versions/loaders, Embeddium for Forge/NeoForge, plus curated bundle flows. | More than a simple mod installer, but compatibility/exclusion data is inconsistent in the native-Vulkan bundle. |
| Diagnostics | Process identity, executable/runtime information from the launch record, CPU/RAM, redacted args, and Windows per-process 3D engine sample where available. | Reports some facts; insufficient to classify all bottlenecks or active GPU reliably. |
| FPS capture | PresentMon-based timed capture and repeated median comparisons. | Useful foundation; signature needs tightening and actual game results are still required. |

## Feather comparison and source confidence

The requested examples—custom in-game GUI and performance toggles—are **not present as launcher features** based on the inspected code. I could not verify Feather's exact current feature names, implementation, or behavior from accessible primary-source pages during this survey: the Feather site/feature/FAQ pages did not resolve, and the public YouTube channel response did not expose usable feature descriptions. Therefore this report does not claim knowledge of Feather's proprietary internals or treat the described behavior as independently verified.

The open-source performance projects below are public alternatives, not evidence of what Feather uses. Any product comparison should be based on a specific public feature description or user-provided screenshot/video and independently repeatable measurements.

## OneClient source-code comparison

The user's “One Client” refers to **[Polyfrost/OneLauncher](https://github.com/Polyfrost/OneLauncher)**, whose README describes the monorepo as containing OneLauncher, OneClient, and their core backend. It says OneClient packages preconfigured mods, while OneLauncher is a separate power-user launcher. The code reviewed here is the public repository snapshot accessed on 14 October 2026, not necessarily every released OneClient build.

### Confirmed OneClient capabilities not present in Bald Launcher

| OneClient repository feature | What the code indicates | Bald Launcher comparison / recommendation |
|---|---|---|
| GPU preference selection | The Minecraft settings page lists detected GPU choices. On Windows, these are generic **Integrated GPU** / **Dedicated GPU** preferences; launch code registers `GpuPreference` for `java.exe` and `javaw.exe` adjacent to the selected Java runtime under `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`. On Linux it selects a detected card and applies vendor offload environment variables. | Bald Launcher reports installed adapter names and per-process counters when available, but has no user-facing GPU selection. An opt-in control would be useful, especially on hybrid laptops. It must target the actual Java executable, explain OS/driver behavior, and not claim selection proves the game used that adapter. |
| Configurable game launch profile | The OneClient Minecraft settings page exposes fullscreen, resolution, memory in MB, JVM arguments, game arguments, and pre-launch / wrapper / post-exit commands. | Bald Launcher has heap and JVM options, but no equivalent game-argument or lifecycle-hook controls in the inspected settings UI. Fullscreen/resolution controls would alter game behavior; they must remain out of scope while the no-video-settings requirement stands. |
| Curated, selectable mod bundles | Its instance onboarding and copy flows present named bundles with descriptions/tags and allow selection; the copy flow states OneConfig is installed regardless of bundle selection. The repository describes OneClient as packaging preconfigured mods. | Bald Launcher has renderer bundles and an isolated opt-in optimization profile, but its renderer allowlist/exclusion conflict is a confirmed bug (P1 above). Improve bundle UX only after dependencies, exclusions, and conflicts are enforced from one install plan. |
| Integrated desktop settings UI | The launcher UI is implemented in Rust with Freya and has dedicated pages/controls for Minecraft, Java, launcher, storage, language, and appearance settings. | Bald Launcher already has a desktop UI and settings; this is not itself a game-FPS feature. The actionable gap is control coverage and clarity, not copying OneClient's toolkit or redesigning Bald Launcher. |
| Java installation/runtime management | The repository includes a Java service and an optional Microsoft OpenJDK prompt/recommendation in addition to runtime lookup/selection. | Bald Launcher resolves a compatible Java major and executable. An explicit runtime manager and display of vendor/version/build could improve diagnostics and reproducibility; switching vendors should be compatibility-checked and benchmarked, not advertised as inherently faster. |

### Important distinction: OneClient's GPU cache is for launcher UI rendering

OneClient's `packages/oneclient_app/src/main.rs` configures Freya's desktop `LaunchConfig` with `with_gpu_resource_cache_limit`, defaulting to 96 MiB and overridable with `ONECLIENT_GPU_CACHE_BYTES`. This is the OneClient **launcher application's UI resource cache**. The inspected code does not establish that it changes Minecraft's renderer cache, GPU cache, or in-game FPS. Do not describe this as evidence that OneClient optimizes Minecraft through a GPU cache.

### OneClient is not proof of a live in-game performance toggle overlay

The inspected OneClient app settings and onboarding code support a configurable desktop launcher and curated mod bundles. Its copy flow says OneConfig is installed even when no bundles are selected, consistent with Minecraft-side configuration supplied through a mod. However, the repository evidence inspected here does **not** verify a specific live in-game performance dashboard, which toggles it exposes, or whether toggles apply immediately without restart. Treat those as unverified until the relevant OneConfig/OneClient mod UI code or a release demonstration is reviewed. This is distinct from the verified launcher-side settings and GPU preference code above.

### OneClient-derived opportunities ranked for Bald Launcher

1. **Implemented first step:** Open the supported Windows Advanced Graphics Settings page, show the exact Java executable to add, read the per-executable Windows preference without modifying it, and report Minecraft's process-observed GPU adapter LUID/index from Windows GPU Engine counters. The user chooses the preference in Windows Settings; Bald Launcher does not claim to force or verify the selected adapter by preference state alone. Remaining: correlate LUIDs to GPU names and add IPC integration tests. Linux is not covered.
2. **High value / correctness:** Show actual Java vendor, runtime version/build, architecture, and executable in diagnostics and benchmark metadata. These are observed runtime facts, unlike a generic “recommended Java” label.
3. **Medium value / safety:** Turn performance bundles into isolated, named profiles with a single source of truth for supported mods, exclusions, dependencies, conflicts, rollback, and release checks.
4. **Optional power-user controls:** Add separate game arguments and lifecycle hooks only with clear quoting, validation, safe command execution, and logging. These do not inherently increase FPS and broaden the security surface.
5. **Do not cargo-cult:** Do not port OneClient's 96 MiB Freya UI GPU resource cache as a Minecraft optimization; it serves the launcher's UI process. Do not silently force fullscreen/resolution or write graphics options while the no-video-settings requirement stands.

### OneClient source links

- [OneLauncher README](https://github.com/Polyfrost/OneLauncher/blob/3e9b9d35b986dccfb103903e14ad37b07ac45693/README.md) — identifies the monorepo and distinguishes OneClient/OneLauncher.
- [Minecraft settings UI](https://github.com/Polyfrost/OneLauncher/blob/3e9b9d35b986dccfb103903e14ad37b07ac45693/packages/oneclient_app/src/view/app/settings/minecraft.rs) — fullscreen, resolution, memory, JVM/game arguments, hooks, and GPU selector.
- [GPU selection implementation](https://github.com/Polyfrost/OneLauncher/blob/3e9b9d35b986dccfb103903e14ad37b07ac45693/packages/oneclient_core/src/game/gpu/mod.rs) — Windows integrated/dedicated selection and Linux GPU offload.
- [Windows GPU preference registration](https://github.com/Polyfrost/OneLauncher/blob/3e9b9d35b986dccfb103903e14ad37b07ac45693/packages/oneclient_java/src/platform.rs) — registers preferences for the Java runtime's `java.exe` / `javaw.exe` siblings.
- [Minecraft launch path](https://github.com/Polyfrost/OneLauncher/blob/3e9b9d35b986dccfb103903e14ad37b07ac45693/packages/oneclient_core/src/game/launch.rs) — applies GPU selection to the launched game command.
- [Freya app setup](https://github.com/Polyfrost/OneLauncher/blob/3e9b9d35b986dccfb103903e14ad37b07ac45693/packages/oneclient_app/src/main.rs) — launcher UI GPU resource-cache limit.
- [Instance bundle onboarding](https://github.com/Polyfrost/OneLauncher/blob/3e9b9d35b986dccfb103903e14ad37b07ac45693/packages/oneclient_app/src/view/onboarding/bundles/mod.rs) and [bundle copy step](https://github.com/Polyfrost/OneLauncher/blob/3e9b9d35b986dccfb103903e14ad37b07ac45693/packages/oneclient_app/src/view/app/clusters/instance/copy.rs) — selectable mod bundles and OneConfig inclusion.

## Online survey: source-backed practices

This is a representative survey of primary documentation and maintained project sources, not a literal crawl of every forum, website, post, and video. Forum anecdotes were not treated as reliable performance evidence.

### Launcher/runtime and platform

- [Mojang version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json) and version metadata define per-release Java/runtime launch requirements and arguments; use release metadata rather than universal copied flags.
- [Prism Launcher Java compatibility check](https://github.com/PrismLauncher/PrismLauncher/blob/develop/launcher/minecraft/launch/VerifyJavaInstall.cpp) and [Java settings](https://github.com/PrismLauncher/PrismLauncher/blob/develop/launcher/ui/widgets/JavaSettingsWidget.cpp) illustrate per-instance Java compatibility and memory allocation controls.
- [Oracle's G1 collector documentation](https://docs.oracle.com/en/java/javase/21/gctuning/garbage-first-g1-garbage-collector1.html) describes pause-time goals, not a real-time guarantee. JVM collector changes must be benchmarked against the actual workload.
- [Intel's Windows graphics preference guidance](https://www.intel.com/content/www/us/en/support/articles/000090168/graphics.html) demonstrates that hybrid-GPU selection is an OS/app setting; configure the Java executable Minecraft launches and verify the active adapter.

### Game-layer optimizations

- [Sodium](https://github.com/CaffeineMC/sodium) and [Embeddium](https://github.com/FiniteReality/embeddium) are rendering-engine projects with distinct loader/version support.
- [Lithium](https://github.com/CaffeineMC/lithium) targets game logic; [FerriteCore](https://github.com/malte0811/FerriteCore) targets memory usage; neither is a universal average-FPS guarantee.
- [ImmediatelyFast](https://github.com/RaphiMC/ImmediatelyFast) targets specific immediate-mode rendering paths; results depend on workload and CPU bottlenecks.
- [Entity Culling](https://github.com/tr7zw/EntityCulling) skips rendering occluded entities/block entities; compatibility and possible visibility/pop-in trade-offs matter.
- [ModernFix](https://github.com/embeddedt/ModernFix) targets startup, world loading, and memory-related behavior; check its current release support before use.
- [Fabulously Optimized](https://github.com/Fabulously-Optimized/fabulously-optimized) is an open-source curated optimization pack and a useful reference for manifest-driven, versioned profile distribution.
- Loader projects—[Fabric](https://docs.fabricmc.net/), [Quilt](https://github.com/QuiltMC/quilt-loader), [Forge](https://docs.minecraftforge.net/en/latest/gettingstarted/), and [NeoForge](https://docs.neoforged.net/)—are compatibility ecosystems, not standalone FPS switches.

### Measurement

- [PresentMon](https://github.com/GameTechDev/PresentMon) provides Windows frame-presentation metrics. Its documentation notes reduced instrumentation for OpenGL and limitations in some CPU-frame-time/latency measurements, relevant to Minecraft Java's rendering path.
- [CapFrameX metric explanation](https://www.capframex.com/blog/post/Explanation%20of%20different%20performance%20metrics) explains frame-time percentiles and low-FPS definitions. Report the metric definition: average FPS alone can hide stutter.
- Separate steady gameplay, world generation/loading, and cold startup tests. Warm up first, hold the world/route/settings/runtime/driver constant, repeat alternating runs, and report medians plus ranges.

## Recommended order of work

1. Add IPC-level tests for the exact bundle dependency/conflict/download flow; helper coverage now verifies bundle allowlists and staged-file rollback.
2. Capture repeated baseline/optimized gameplay measurements using PresentMon, with matching Java, heap, world, settings, and hardware; no FPS gain is claimed until these exist.
3. Remove or qualify unmeasured RAM/JVM recommendations and align JVM labels.
4. Preserve vanilla settings and require explicit user choice before installing any optional mods; never modify an existing profile silently.
5. Improve diagnostics with only reliable signals, label unknowns, and guide Windows per-app GPU selection for the actual Java executable.
6. Develop an optional Minecraft-side settings/monitoring interface with a separately defined compatibility and toggle scope.
