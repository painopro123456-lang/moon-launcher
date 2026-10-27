const api = window.moonLauncher;
const state = { versions: [], instances: [], view: "home", toastTimer: null, activeInstall: null, account: null, settings: null, verificationUri: "", signInPromise: null, servers: [], modsInstanceId: "", modpackPage: 1, modpackTotal: 0, modpackQuery: "", modpackRequestId: 0, modpacksLoaded: false, logs: [], logSequence: 0 };

const $ = (selector) => document.querySelector(selector);

function addLog(level, message, source = "Launcher") {
  const clean = String(message || "").trim();
  if (!clean) return;
  state.logs.push({ id: ++state.logSequence, time: new Date(), level, source, message: clean });
  if (state.logs.length > 1500) state.logs.splice(0, state.logs.length - 1500);
  renderLogs();
}
function visibleLogs() {
  const query = ($("#logs-search")?.value || "").trim().toLowerCase();
  const level = $("#logs-level")?.value || "all";
  return state.logs.filter((entry) => (level === "all" || entry.level === level) &&
    (!query || (entry.message + " " + entry.source + " " + entry.level).toLowerCase().includes(query)));
}
function renderLogs() {
  const host = $("#logs-list");
  if (!host) return;
  const entries = visibleLogs();
  $("#logs-count").textContent = entries.length + (entries.length === 1 ? " entry" : " entries");
  host.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "logs-empty";
    const title = document.createElement("strong");
    title.textContent = state.logs.length ? "No matching entries" : "No log entries yet";
    const detail = document.createElement("p");
    detail.textContent = state.logs.length ? "Try another search or level filter." : "Launcher activity will appear here as you use Moon Launcher.";
    empty.append(title, detail);
    host.append(empty);
    return;
  }
  for (const entry of [...entries].reverse()) {
    const row = document.createElement("div");
    row.className = "log-row";
    const time = document.createElement("time");
    time.className = "log-time";
    time.dateTime = entry.time.toISOString();
    time.textContent = entry.time.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const level = document.createElement("span");
    level.className = "log-level log-level-" + entry.level;
    level.textContent = entry.level.toUpperCase();
    const message = document.createElement("div");
    message.className = "log-message";
    const text = document.createElement("span");
    text.textContent = entry.message;
    const source = document.createElement("small");
    source.textContent = entry.source;
    message.append(text, source);
    row.append(time, level, message);
    host.append(row);
  }
}
function exportVisibleLogs() {
  const entries = visibleLogs();
  const text = entries.map((entry) => "[" + entry.time.toISOString() + "] [" + entry.level.toUpperCase() + "] [" + entry.source + "] " + entry.message).join("\n");
  return text || "Moon Launcher — no matching log entries.";
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3600);
}

function setCatalogState(online, message) {
  $("#catalog-label").textContent = message;
  $(".status-dot").classList.toggle("offline", !online);
}

function setView(view) {
  state.view = view;
  if (view === "modpacks" && !state.modpacksLoaded) searchModpacks(1);
  if (view === "logs") renderLogs();
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  $("#" + view + "-view").classList.add("active");
  const titles = {
    home: ["YOUR GAME LIBRARY", "Welcome to Moon"],
    modpacks: ["BROWSE AND IMPORT", "Modpacks"],
    logs: ["DIAGNOSTICS & ACTIVITY", "Launcher logs"],
    mods: ["TUNE YOUR GAME", "Mod manager"],
    servers: ["MULTIPLAYER SHORTCUTS", "Server list"],
    settings: ["MAKE IT YOURS", "Settings"]
  };
  $("#page-kicker").textContent = titles[view][0];
  $("#page-title").textContent = titles[view][1];
}

function renderInstances() {
  const host = $("#instance-list");
  host.replaceChildren();
  $("#instance-count").textContent = String(state.instances.length);

  if (state.instances.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = "No instances yet. Create one for a Minecraft version or import a modpack manifest.";
    host.append(empty);
    return;
  }

  $("#quick-play").disabled = !state.instances.some((item) => { const loader = String(item.pack?.loader || "Vanilla"); return loader === "Vanilla" || /(?:^|[,\s])fabric-loader\s+[0-9][A-Za-z0-9.+_-]*/i.test(loader); });
  for (const instance of state.instances) {
    const card = document.createElement("article");
    card.className = "instance-card";

    const top = document.createElement("div");
    top.className = "instance-top";
    const icon = document.createElement("div");
    icon.className = "instance-icon";
    icon.textContent = instance.source === "vanilla" ? "◈" : "▦";
    const badge = document.createElement("span");
    badge.className = "instance-badge";
    badge.textContent = instance.installState === "files-ready" ? "Files ready" : instance.installState === "installed" ? "Ready" : "Setup needed";
    top.append(icon, badge);

    const title = document.createElement("h3");
    title.textContent = instance.name;
    const detail = document.createElement("p");
    const packInfo = instance.pack
      ? " · " + instance.pack.source + (instance.pack.loader && instance.pack.loader !== "Vanilla" ? " · " + instance.pack.loader : "")
      : "";
    detail.textContent = "Minecraft " + instance.minecraftVersion + packInfo;
    card.dataset.instanceId = instance.id;
    const launch = document.createElement("button");
    launch.className = "launch-button";
    launch.textContent = instance.installState === "installed" ? "Play" : "Install & Play";
    const loaderName = String(instance.pack?.loader || "Vanilla");
    const isUnsupportedLoaderPack = loaderName !== "Vanilla" && !/(?:^|[,\s])fabric-loader\s+[0-9][A-Za-z0-9.+_-]*/i.test(loaderName);
    launch.disabled = isUnsupportedLoaderPack;
    launch.title = isUnsupportedLoaderPack
      ? "Forge/NeoForge packs are not supported yet. Vanilla and Fabric packs can launch."
      : "Install or launch this Minecraft instance.";
    launch.addEventListener("click", () => launchMinecraftInstance(instance.id, launch));

    const actions = document.createElement("div");
    actions.className = "instance-actions";
    const remove = document.createElement("button");
    remove.className = "instance-delete-button";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.title = "Delete this instance and its instance-specific files";
    remove.addEventListener("click", async () => {
      const confirmed = confirm("Delete \"" + instance.name + "\"? This permanently removes this instance and its mods, configs, and instance-specific files. Shared Minecraft version files will be kept.");
      if (!confirmed) return;
      remove.disabled = true;
      remove.textContent = "Deleting…";
      try {
        await api.deleteInstance(instance.id);
        state.instances = state.instances.filter((item) => item.id !== instance.id);
        if (state.modsInstanceId === instance.id) { state.modsInstanceId = ""; }
        renderInstances();
        refreshModsInstanceOptions();
        showToast("Instance deleted.");
      } catch (error) {
        remove.disabled = false;
        remove.textContent = "Delete";
        showToast(error.message || "Could not delete this instance.");
      }
    });
    actions.append(launch, remove);
    card.append(top, title, detail, actions);
    host.append(card);
  }
}

async function launchMinecraftInstance(instanceId, button) {
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    await api.launchInstance(instanceId);
  } catch (error) {
    button.disabled = false;
    const instance = state.instances.find((item) => item.id === instanceId);
    button.textContent = instance?.installState === "installed" ? "Play" : "Install & Play";
    showToast(error.message || "Minecraft could not be launched.");
  }
}

function handleLauncherProgress(progress) {
  addLog(progress.status === "error" ? "error" : progress.status === "closed" && /error/i.test(progress.message || "") ? "warning" : progress.status === "running" ? "success" : "info", progress.message || progress.status, "Minecraft");
  const quickButton = $("#quick-play");
  if (state.instances[0]?.id === progress.instanceId || quickButton.dataset.instanceId === progress.instanceId) {
    if (progress.status === "running") { quickButton.textContent = "Minecraft running"; quickButton.disabled = true; }
    else if (["closed", "error"].includes(progress.status)) { quickButton.textContent = "▶ Quick Play"; quickButton.disabled = !state.instances.some((item) => { const loader = String(item.pack?.loader || "Vanilla"); return loader === "Vanilla" || /(?:^|[,\s])fabric-loader\s+[0-9][A-Za-z0-9.+_-]*/i.test(loader); }); delete quickButton.dataset.instanceId; }
    else { quickButton.textContent = progress.message || "Starting…"; quickButton.disabled = true; quickButton.dataset.instanceId = progress.instanceId; }
  }
  const card = [...document.querySelectorAll(".instance-card")].find((item) => item.dataset.instanceId === progress.instanceId);
  const button = card?.querySelector(".launch-button");
  if (!button) return;
  if (progress.status === "running") {
    const instance = state.instances.find((item) => item.id === progress.instanceId);
    if (instance) instance.installState = "installed";
    const badge = card.querySelector(".instance-badge");
    if (badge) badge.textContent = "Ready";
  }
  if (["closed", "error"].includes(progress.status)) {
    button.disabled = false;
    const instance = state.instances.find((item) => item.id === progress.instanceId);
    button.textContent = instance?.installState === "installed" ? "Play" : "Install & Play";
    if (progress.status === "error") showToast(progress.message || "Minecraft could not start.");
    return;
  }
  button.disabled = true;
  button.textContent = progress.status === "running" ? "Minecraft running" : (progress.message || "Starting…");
}

function renderAccount(status) {
  state.account = status;
  const name = status?.signedIn ? status.username : "Not signed in";
  const detail = status?.signedIn ? (status.offline ? "Offline account" : "Microsoft account connected") : "Minecraft account";
  $(".account-card strong").textContent = name;
  $(".account-card span").textContent = detail;
  $(".avatar").textContent = status?.signedIn ? String(name || "M").slice(0, 1).toUpperCase() : "?";
  $("#settings-account-name").textContent = status?.signedIn ? "Signed in as " + name : "Not signed in";
  $("#settings-account-detail").textContent = status?.signedIn
    ? (status.offline
      ? "Offline profile active. Online-mode servers still require an authenticated account."
      : "This Microsoft account is ready for Minecraft.")
    : "Sign in with Microsoft or choose an offline username.";
  $("#offline-account-button").textContent = status?.offline ? "Change offline username" : "Use offline account";
  $("#sign-in-button").hidden = Boolean(status?.signedIn);
  $("#topbar-sign-in").hidden = Boolean(status?.signedIn);
  $("#topbar-sign-in").textContent = status?.signedIn ? "Signed in" : "Sign in";
  $("#sign-out-button").hidden = !status?.signedIn;
  loadSavedAccounts();
}

async function refreshAccountStatus() {
  try { renderAccount(await api.getAccountStatus()); }
  catch (error) { showToast(error.message || "Could not read the saved Minecraft account."); }
}

async function loadSavedAccounts() {
  const select = $("#account-profile-select");
  if (!select) return;
  try {
    const accounts = await api.getSavedAccounts();
    select.replaceChildren();
    if (!accounts.length) select.add(new Option("No saved accounts yet", ""));
    for (const account of accounts) {
      const option = new Option(account.username + (account.offline ? " · Offline" : "") + (account.active ? " · Active" : ""), account.uuid);
      select.add(option);
    }
    $("#switch-account-button").disabled = !accounts.length;
    $("#remove-account-button").disabled = !accounts.length;
  } catch (error) { showToast(error.message || "Could not load saved accounts."); }
}

async function loadSettings() {
  try {
    state.settings = await api.getSettings();
    $("#game-directory-path").textContent = state.settings.gameDirectory;
    $("#memory-setting").value = String(state.settings.memoryGb);
    $("#connections-setting").value = String(state.settings.downloadConnections);
    $("#fullscreen-setting").checked = Boolean(state.settings.fullscreen);
    const background = await api.getCustomBackground();
    applyCustomBackground(background.dataUrl);
  } catch (error) {
    showToast(error.message || "Could not load launcher settings.");
  }
}

async function saveLauncherSettings() {
  const saveButton = $("#save-launcher-settings");
  saveButton.disabled = true;
  try {
    state.settings = await api.saveSettings({
      memoryGb: $("#memory-setting").value === "auto" ? "auto" : Number($("#memory-setting").value),
      downloadConnections: Number($("#connections-setting").value),
      fullscreen: $("#fullscreen-setting").checked
    });
    $("#settings-save-status").textContent = "Settings saved.";
    showToast("Launcher settings saved.");
  } catch (error) {
    $("#settings-save-status").textContent = "Could not save these settings.";
    showToast(error.message || "Could not save settings.");
  } finally {
    saveButton.disabled = false;
  }
}

async function changeLauncherDirectory() {
  try {
    const settings = await api.chooseLauncherDirectory();
    if (settings.canceled) return;
    state.settings = settings;
    $("#game-directory-path").textContent = settings.gameDirectory;
    await loadInstances();
    showToast("Moon Launcher files are now stored in the chosen folder.");
  } catch (error) {
    showToast(error.message || "Could not change the Moon Launcher folder.");
  }
}

function openAuthDialog() {
  $("#auth-status-message").textContent = "Preparing secure Microsoft sign-in…";
  $("#auth-code-panel").hidden = true;
  if (!$("#auth-dialog").open) $("#auth-dialog").showModal();
}

async function startMicrosoftSignIn() {
  openAuthDialog();
  state.signInPromise = api.signInMicrosoft();
  try {
    const account = await state.signInPromise;
    renderAccount(account);
    $("#auth-status-message").textContent = "You're signed in as " + account.username + ".";
    $("#auth-code-panel").hidden = true;
    showToast("Signed in as " + account.username + ".");
    setTimeout(() => { if ($("#auth-dialog").open) $("#auth-dialog").close(); }, 900);
  } catch (error) {
    $("#auth-status-message").textContent = error.message || "Microsoft sign-in could not be completed.";
    if (!/canceled/i.test(error.message || "")) showToast(error.message || "Microsoft sign-in failed.");
  } finally {
    state.signInPromise = null;
  }
}

async function cancelMicrosoftSignIn() {
  if (state.signInPromise) await api.cancelSignIn().catch(() => {});
  if ($("#auth-dialog").open) $("#auth-dialog").close();
}

api.onAuthProgress((progress) => {
  if (progress.message) addLog(progress.status === "error" ? "error" : progress.status === "signed-in" ? "success" : "info", progress.message, "Account");
  if (progress.status === "starting") openAuthDialog();
  if (progress.status === "browser-login" || progress.status === "token-exchange") {
    $("#auth-status-message").textContent = progress.message || "Continue signing in through your browser…";
    $("#auth-code-panel").hidden = true;
  }
  if (progress.status === "device-code") {
    state.verificationUri = progress.verificationUri;
    $("#auth-status-message").textContent = progress.message || "Enter this code on Microsoft's sign-in page.";
    $("#auth-user-code").textContent = progress.userCode || "Check the sign-in details";
    $("#auth-code-panel").hidden = false;
  } else if (progress.status === "signed-in") {
    $("#auth-status-message").textContent = progress.message || "Microsoft sign-in complete.";
    $("#auth-code-panel").hidden = true;
    refreshAccountStatus();
  } else if (progress.status === "error") {
    $("#auth-status-message").textContent = progress.message || "Microsoft sign-in failed.";
  }
});
api.onLauncherProgress(handleLauncherProgress);

function renderSearchResults(projects) {
  const host = $("#modpack-results");
  host.replaceChildren();

  if (projects.length === 0) {
    const message = document.createElement("div");
    message.className = "search-message";
    message.textContent = state.modpackQuery
      ? "No modpacks found for this search. Try another phrase."
      : "No modpacks were returned. Check your connection and try again.";
    host.append(message);
    renderModpackPagination();
    return;
  }

  for (const project of projects) {
    const card = document.createElement("article");
    card.className = "modpack-card";
    if (project.iconUrl) {
      const image = document.createElement("img");
      image.src = project.iconUrl;
      image.alt = "";
      image.loading = "lazy";
      card.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "pack-placeholder";
      placeholder.textContent = "✦";
      card.append(placeholder);
    }

    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = project.title;
    const description = document.createElement("p");
    description.textContent = project.description || "No description provided.";

    const actions = document.createElement("div");
    actions.className = "modpack-actions";
    const install = document.createElement("button");
    install.className = "primary-button install-pack-button";
    install.textContent = "Install pack";
    install.addEventListener("click", () => chooseModrinthPackVersion(project, install));

    const link = document.createElement("button");
    link.className = "project-link";
    link.textContent = "View on Modrinth ↗";
    link.addEventListener("click", async () => {
      try { await api.openModrinthProject(project.slug); }
      catch (error) { showToast(error.message); }
    });

    actions.append(install, link);
    content.append(title, description, actions);
    card.append(content);
    host.append(card);
  }
  renderModpackPagination();
}

function renderModpackPagination() {
  const host = $("#modpack-pagination");
  if (!host) return;
  host.replaceChildren();
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(state.modpackTotal / pageSize));
  const summary = document.createElement("span");
  summary.className = "pagination-summary";
  const first = state.modpackTotal === 0 ? 0 : ((state.modpackPage - 1) * pageSize) + 1;
  const last = Math.min(state.modpackPage * pageSize, state.modpackTotal);
  summary.textContent = state.modpackTotal
    ? `Showing ${first}–${last} of ${state.modpackTotal.toLocaleString()} modpacks`
    : "No results";
  const controls = document.createElement("div");
  controls.className = "pagination-controls";

  const addPageButton = (label, page, options = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = options.active
      ? "secondary-button pagination-button pagination-number active"
      : "secondary-button pagination-button pagination-number";
    button.textContent = label;
    button.disabled = Boolean(options.disabled) || page === state.modpackPage;
    if (options.active) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => searchModpacks(page));
    controls.append(button);
  };

  addPageButton("«", 1, { disabled: state.modpackPage <= 1 });
  addPageButton("←", state.modpackPage - 1, { disabled: state.modpackPage <= 1 });
  const startPage = Math.max(1, Math.min(state.modpackPage - 2, totalPages - 4));
  const endPage = Math.min(totalPages, startPage + 4);
  for (let page = startPage; page <= endPage; page++) {
    addPageButton(String(page), page, { active: page === state.modpackPage });
  }
  addPageButton("→", state.modpackPage + 1, { disabled: state.modpackPage >= totalPages });
  addPageButton("»", totalPages, { disabled: state.modpackPage >= totalPages });

  const pageLabel = document.createElement("span");
  pageLabel.className = "pagination-page";
  pageLabel.textContent = `Page ${state.modpackPage} of ${totalPages.toLocaleString()}`;
  host.append(summary, controls, pageLabel);
}

async function chooseModrinthPackVersion(project, sourceButton) {
  if (state.activeInstall) { showToast("A modpack is already installing. Please wait for it to finish."); return; }
  const dialog = document.createElement("dialog"); dialog.className = "dialog pack-version-dialog";
  const header = document.createElement("div"); header.className = "dialog-header";
  const heading = document.createElement("div"); const eyebrow = document.createElement("div"); eyebrow.className = "eyebrow"; eyebrow.textContent = "CHOOSE YOUR BUILD";
  const title = document.createElement("h2"); title.textContent = project.title; heading.append(eyebrow, title);
  const close = document.createElement("button"); close.type = "button"; close.className = "close-button"; close.setAttribute("aria-label", "Close"); close.textContent = "×"; close.addEventListener("click", () => dialog.close()); header.append(heading, close);
  const intro = document.createElement("p"); intro.className = "auth-instructions"; intro.textContent = "Choose the modpack release you want. Each option shows its Minecraft version and mod loader.";
  const status = document.createElement("p"); status.className = "pack-version-status"; status.textContent = "Loading available versions…";
  const list = document.createElement("div"); list.className = "pack-version-list";
  const actions = document.createElement("div"); actions.className = "dialog-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "secondary-button"; cancel.textContent = "Cancel"; cancel.addEventListener("click", () => dialog.close());
  const install = document.createElement("button"); install.type = "button"; install.className = "primary-button"; install.textContent = "Install selected version"; install.disabled = true; actions.append(cancel, install);
  dialog.append(header, intro, status, list, actions); document.body.append(dialog); dialog.addEventListener("close", () => dialog.remove(), { once: true }); dialog.showModal();
  try {
    const versions = await api.getModrinthPackVersions(project);
    if (!dialog.isConnected || !dialog.open) return;
    if (!versions.length) { status.textContent = "No downloadable modpack versions were found."; return; }
    status.textContent = versions.length + " downloadable version" + (versions.length === 1 ? "" : "s") + " available";
    const radios = [];
    for (const version of versions) {
      const label = document.createElement("label"); label.className = "pack-version-option";
      const radio = document.createElement("input"); radio.type = "radio"; radio.name = "pack-version"; radio.value = version.id; radio.checked = radios.length === 0;
      const copy = document.createElement("span"); copy.className = "pack-version-copy";
      const name = document.createElement("strong"); name.textContent = version.name;
      const details = document.createElement("span"); details.textContent = (version.gameVersions.length ? version.gameVersions.join(", ") : "Minecraft version not listed") + " · " + (version.loaders.length ? version.loaders.join(" · ") : "Loader not listed");
      const meta = document.createElement("span"); meta.className = "pack-version-meta";
      const type = document.createElement("span"); type.className = "pack-version-type" + (version.type === "release" ? " is-release" : ""); type.textContent = version.type;
      const file = document.createElement("span"); file.textContent = version.size ? (version.size / 1024 / 1024).toFixed(1) + " MB" : version.fileName;
      meta.append(type, file); copy.append(name, details, meta); label.append(radio, copy);
      label.addEventListener("click", () => radios.forEach((item) => item.label.classList.toggle("selected", item.radio.checked)));
      if (radio.checked) label.classList.add("selected"); radios.push({ radio, label }); list.append(label);
    }
    install.disabled = false;
    install.addEventListener("click", async () => { const chosen = radios.find((item) => item.radio.checked)?.radio.value; if (!chosen) return; dialog.close(); await installModrinthPack(project, sourceButton, chosen); });
  } catch (error) { status.textContent = error.message || "Could not load modpack versions."; }
}
async function installModrinthPack(project, button, versionId) {
  if (state.activeInstall) {
    showToast("A modpack is already installing. Please wait for it to finish.");
    return;
  }

  state.activeInstall = { projectId: project.id, button };
  button.disabled = true;
  button.textContent = "Starting…";
  try {
    const instance = await api.installModrinthPack(project, versionId);
    state.instances.unshift(instance);
    renderInstances();
    button.textContent = "Installed";
    showToast(instance.name + " pack files are ready.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Try again";
    showToast(error.message || "Could not install this Modrinth pack.");
  } finally {
    state.activeInstall = null;
  }
}

api.onModpackProgress((progress) => {
  if (progress.message) addLog("info", progress.message, "Modpacks");
  if (!state.activeInstall || progress.projectId !== state.activeInstall.projectId) return;
  state.activeInstall.button.textContent = progress.message || "Installing…";
});

async function loadVersions() {
  const select = $("#version-select");
  try {
    const catalog = await api.getVersions();
    state.versions = catalog.versions || [];
    $("#latest-release").textContent = catalog.latest?.release || "—";
    $("#latest-snapshot").textContent = catalog.latest?.snapshot || "—";
    setCatalogState(true, "Minecraft catalog online");

    const versionOptions = state.versions.slice(0, 250);
    const releases = document.createElement("optgroup");
    releases.label = "Stable releases";
    const snapshots = document.createElement("optgroup");
    snapshots.label = "Snapshots";

    for (const version of versionOptions) {
      const option = document.createElement("option");
      option.value = version.id;
      const isLatestRelease = version.id === catalog.latest?.release;
      const isLatestSnapshot = version.id === catalog.latest?.snapshot;
      option.textContent = version.id
        + (isLatestRelease ? " · Latest release" : "")
        + (isLatestSnapshot ? " · Latest snapshot" : "");
      (version.type === "snapshot" ? snapshots : releases).append(option);
    }

    select.replaceChildren();
    const pinnedVersions = ["26.3", "26.2", "1.21.11", "1.8.9"];
    const pinned = document.createElement("optgroup");
    pinned.label = "Quick versions";
    for (const id of pinnedVersions) {
      if (!state.versions.some((version) => version.id === id)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = id + " · Quick version";
        pinned.append(option);
      }
    }
    if (pinned.children.length) select.append(pinned);
    if (releases.children.length) select.append(releases);
    if (snapshots.children.length) select.append(snapshots);
    select.disabled = false;
  } catch (error) {
    setCatalogState(false, "Minecraft catalog unavailable");
    select.replaceChildren(new Option("Could not load versions", ""));
    showToast("Could not load the Minecraft version list. Check your connection and retry.");
  }
}

async function loadInstances() {
  try {
    state.instances = await api.getInstances();
    renderInstances();
    refreshModsInstanceOptions();
  } catch (error) {
    showToast("Could not load local instances.");
  }
}

async function createInstance(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    const instance = await api.createInstance({
      name: formData.get("name"),
      version: formData.get("version")
    });
    state.instances.unshift(instance);
    renderInstances();
    form.closest("dialog").close();
    form.reset();
    showToast("Instance added. Press Install & Play to set it up.");
  } catch (error) {
    showToast(error.message || "Could not create the instance.");
  }
}

async function importPack() {
  if (state.activeInstall) {
    showToast("Wait for the current modpack install to finish first.");
    return;
  }
  try {
    const instance = await api.importModpack();
    if (!instance) return;
    state.instances.unshift(instance);
    renderInstances();
    if (instance.installState === "files-ready") {
      showToast(instance.name + " pack files are ready.");
    } else if (instance.source === "curseforge") {
      showToast("Added the CurseForge pack details. Its files need an approved CurseForge integration.");
    } else {
      const count = instance.pack?.files ?? 0;
      showToast("Imported " + instance.name + " (" + count + " file entries).");
    }
  } catch (error) {
    showToast(error.message || "Could not import that modpack.");
  }
}

async function loadModsForSelectedInstance() {
  const select = $("#mods-instance-select");
  const selectedId = select.value;
  state.modsInstanceId = selectedId;
  const host = $("#mods-list");
  host.replaceChildren();
  if (!selectedId) {
    const empty = document.createElement("div"); empty.className = "empty-card"; empty.textContent = "Create an instance first to manage its mods."; host.append(empty); return;
  }
  const loading = document.createElement("div"); loading.className = "search-message"; loading.textContent = "Loading instance mods…"; host.append(loading);
  try {
    const result = await api.listInstanceMods(selectedId);
    host.replaceChildren();
    if (!result.mods.length) {
      const empty = document.createElement("div"); empty.className = "empty-card"; empty.textContent = "No .jar mods found. Add mod files to this instance's mods folder, then refresh."; host.append(empty); return;
    }
    for (const mod of result.mods) {
      const row = document.createElement("article"); row.className = "mod-row";
      const info = document.createElement("div"); info.className = "mod-row-info";
      const title = document.createElement("strong"); title.textContent = mod.name;
      const detail = document.createElement("span"); detail.textContent = (mod.enabled ? "Enabled" : "Disabled") + " · " + formatBytes(mod.size);
      info.append(title, detail);
      const actions = document.createElement("div"); actions.className = "setting-actions";
      const toggle = document.createElement("button"); toggle.className = "secondary-button"; toggle.textContent = mod.enabled ? "Disable" : "Enable";
      toggle.addEventListener("click", async () => { toggle.disabled = true; try { await api.toggleInstanceMod(selectedId, mod.name); await loadModsForSelectedInstance(); showToast(mod.enabled ? "Mod disabled." : "Mod enabled."); } catch (error) { toggle.disabled = false; showToast(error.message || "Could not toggle mod."); } });
      const remove = document.createElement("button"); remove.className = "text-button"; remove.textContent = "Remove";
      remove.addEventListener("click", async () => { if (!confirm("Remove " + mod.name + " from this instance?")) return; try { await api.deleteInstanceMod(selectedId, mod.name); await loadModsForSelectedInstance(); showToast("Mod removed from this instance."); } catch (error) { showToast(error.message || "Could not remove mod."); } });
      actions.append(toggle, remove); row.append(info, actions); host.append(row);
    }
  } catch (error) {
    host.replaceChildren(); const message = document.createElement("div"); message.className = "search-message"; message.textContent = error.message || "Could not read this instance's mods."; host.append(message);
  }
}
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
function refreshModsInstanceOptions() {
  const select = $("#mods-instance-select");
  const previous = select.value;
  select.replaceChildren();
  if (!state.instances.length) select.add(new Option("No instances available", ""));
  for (const instance of state.instances) select.add(new Option(instance.name + " · " + instance.minecraftVersion, instance.id));
  if (state.instances.some((item) => item.id === previous)) select.value = previous;
  else if (state.instances[0]) select.value = state.instances[0].id;
  loadModsForSelectedInstance();
}
async function loadServers() {
  try { state.servers = await api.getServers(); renderServers(); }
  catch (error) { showToast(error.message || "Could not load saved servers."); }
}
function renderServers() {
  const host = $("#server-list"); host.replaceChildren();
  if (!state.servers.length) {
    const empty = document.createElement("div"); empty.className = "empty-card"; empty.textContent = "No servers saved yet. Add a server above to keep its address handy."; host.append(empty); return;
  }
  for (const server of state.servers) {
    const row = document.createElement("article"); row.className = "server-card";
    const info = document.createElement("div"); info.className = "server-card-info";
    const name = document.createElement("h3"); name.textContent = server.name;
    const address = document.createElement("code"); address.textContent = server.address;
    info.append(name, address);
    const actions = document.createElement("div"); actions.className = "setting-actions";
    const copy = document.createElement("button"); copy.className = "secondary-button"; copy.textContent = "Copy address";
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(server.address); showToast("Server address copied."); } catch { showToast("Copy failed. Select the address and copy it manually."); } });
    const remove = document.createElement("button"); remove.className = "text-button"; remove.textContent = "Remove";
    remove.addEventListener("click", async () => { try { state.servers = await api.removeServer(server.id); renderServers(); showToast("Server removed."); } catch (error) { showToast(error.message || "Could not remove server."); } });
    actions.append(copy, remove); row.append(info, actions); host.append(row);
  }
}
function applyCustomBackground(dataUrl) {
  const hero = $(".hero-card");
  if (!hero) return;
  hero.style.backgroundImage = dataUrl
    ? "linear-gradient(90deg, rgba(20, 17, 30, .97) 0%, rgba(20, 17, 30, .82) 52%, rgba(20, 17, 30, .35) 100%), url('" + dataUrl + "')"
    : "";
}
async function chooseCustomBackground() {
  try {
    const result = await api.chooseCustomBackground();
    if (result.canceled) return;
    applyCustomBackground(result.dataUrl);
    showToast("Custom background updated.");
  } catch (error) { showToast(error.message || "Could not set that background."); }
}
async function resetCustomBackground() {
  try { await api.resetCustomBackground(); applyCustomBackground(""); showToast("Default background restored."); }
  catch (error) { showToast(error.message || "Could not reset background."); }
}

async function searchModpacks(page = 1) {
  const query = $("#modpack-query").value.trim();
  const host = $("#modpack-results");
  const requestId = ++state.modpackRequestId;
  state.modpackQuery = query;
  state.modpackPage = Math.max(1, Number(page) || 1);
  host.replaceChildren();
  $("#modpack-pagination").replaceChildren();
  const loading = document.createElement("div");
  loading.className = "search-message";
  loading.textContent = state.modpackPage === 1 && !query
    ? "Loading popular Modrinth modpacks…"
    : `Loading modpack page ${state.modpackPage}…`;
  host.append(loading);
  try {
    const result = await api.searchModpacks({ query, page: state.modpackPage });
    if (requestId !== state.modpackRequestId) return;
    state.modpackTotal = result.total;
    state.modpackPage = result.page;
    state.modpacksLoaded = true;
    renderSearchResults(result.projects || []);
  } catch (error) {
    if (requestId !== state.modpackRequestId) return;
    host.replaceChildren();
    const message = document.createElement("div");
    message.className = "search-message";
    message.textContent = error.message || "Modrinth search is unavailable.";
    host.append(message);
    $("#modpack-pagination").replaceChildren();
    state.modpacksLoaded = false;
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
$("#logs-search").addEventListener("input", renderLogs);
$("#logs-level").addEventListener("change", renderLogs);
$("#logs-clear").addEventListener("click", () => { state.logs = []; renderLogs(); addLog("info", "Log view cleared."); });
$("#logs-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(exportVisibleLogs()); showToast("Visible logs copied."); }
  catch { showToast("Clipboard access is unavailable."); }
});
$("#logs-export").addEventListener("click", () => {
  const blob = new Blob([exportVisibleLogs()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "moon-launcher-logs-" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Log snapshot exported.");
});
$("#new-instance").addEventListener("click", () => $("#instance-dialog").showModal());
$("#quick-play").addEventListener("click", () => {
  const instance = state.instances.find((item) => { const loader = String(item.pack?.loader || "Vanilla"); return loader === "Vanilla" || /(?:^|[,\s])fabric-loader\s+[0-9][A-Za-z0-9.+_-]*/i.test(loader); });
  const card = instance && [...document.querySelectorAll(".instance-card")].find((item) => item.dataset.instanceId === instance.id);
  const launchButton = card?.querySelector(".launch-button");
  if (launchButton && !launchButton.disabled) { $("#quick-play").dataset.instanceId = instance.id; launchButton.click(); }
  else if (instance) showToast("That instance is already starting or running.");
});
$("#mods-instance-select").addEventListener("change", loadModsForSelectedInstance);
$("#refresh-mods").addEventListener("click", loadModsForSelectedInstance);
$("#open-mods-folder").addEventListener("click", async () => { if (!$("#mods-instance-select").value) return showToast("Create an instance first."); try { await api.openInstanceModsFolder($("#mods-instance-select").value); } catch (error) { showToast(error.message || "Could not open the mods folder."); } });
$("#server-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try { state.servers = await api.addServer({ name: data.get("name"), address: data.get("address") }); form.reset(); renderServers(); showToast("Server saved."); }
  catch (error) { showToast(error.message || "Could not save server."); }
});
$("#choose-background").addEventListener("click", chooseCustomBackground);
$("#reset-background").addEventListener("click", resetCustomBackground);
$("#switch-account-button").addEventListener("click", async () => {
  const uuid = $("#account-profile-select").value;
  if (!uuid) return;
  try { renderAccount(await api.switchSavedAccount(uuid)); await loadSavedAccounts(); showToast("Switched Minecraft account."); }
  catch (error) { showToast(error.message || "Could not switch account."); }
});
$("#remove-account-button").addEventListener("click", async () => {
  const uuid = $("#account-profile-select").value;
  if (!uuid) return;
  if (!confirm("Remove this saved account from Moon Launcher? You may need to sign in again to use it.")) return;
  try { const result = await api.removeSavedAccount(uuid); renderAccount(result.status); await loadSavedAccounts(); showToast("Saved account removed."); }
  catch (error) { showToast(error.message || "Could not remove saved account."); }
});
document.querySelectorAll(".quick-version").forEach((button) => {
  button.addEventListener("click", () => {
    const version = button.dataset.version;
    const select = $("#version-select");
    const nameInput = $('#instance-form input[name="name"]');
    if (![...select.options].some((option) => option.value === version)) {
      const option = new Option(version + " · Quick version", version);
      select.add(option, 0);
    }
    select.value = version;
    nameInput.value = "Minecraft " + version;
    $("#instance-dialog").showModal();
  });
});
$("#close-instance-dialog").addEventListener("click", () => $("#instance-dialog").close());
$("#instance-form").addEventListener("submit", createInstance);
$("#import-pack").addEventListener("click", importPack);
$("#import-pack-secondary").addEventListener("click", importPack);
$("#search-modpacks").addEventListener("click", () => searchModpacks(1));
$("#modpack-query").addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchModpacks(1);
});
$("#open-folder").addEventListener("click", () => api.openInstanceFolder());
$(".account-card").addEventListener("click", () => { if (state.account?.signedIn) setView("settings"); else startMicrosoftSignIn(); });
$(".account-card").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (state.account?.signedIn) setView("settings"); else startMicrosoftSignIn(); } });
$("#open-folder-settings").addEventListener("click", () => api.openInstanceFolder());
$("#sign-in-button").addEventListener("click", startMicrosoftSignIn);
$("#offline-account-button").addEventListener("click", () => {
  $("#offline-username").value = state.account?.offline ? state.account.username : "";
  $("#offline-account-dialog").showModal();
});
$("#close-offline-dialog").addEventListener("click", () => $("#offline-account-dialog").close());
$("#offline-account-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = $("#offline-username").value.trim();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const account = await api.createOfflineAccount(username);
    renderAccount(account);
    await loadSavedAccounts();
    $("#offline-account-dialog").close();
    showToast("Offline account active: " + account.username + ".");
  } catch (error) {
    showToast(error.message || "Could not create the offline account.");
  } finally {
    button.disabled = false;
  }
});
$("#sign-out-button").addEventListener("click", async () => { try { await api.signOutMicrosoft(); await refreshAccountStatus(); await loadSavedAccounts(); showToast("Signed out. Your saved account profiles remain available."); } catch (error) { showToast(error.message); } });
$("#check-updates-button").addEventListener("click", async () => {
  const button = $("#check-updates-button");
  button.disabled = true;
  try { await api.checkForUpdates(); }
  catch (error) { showToast(error.message || "Could not check for updates."); }
  finally { button.disabled = false; }
});
$("#restart-update-button").addEventListener("click", async () => {
  $("#restart-update-button").disabled = true;
  $("#update-status").textContent = "Restarting to install the update…";
  try { await api.installUpdate(); }
  catch (error) { $("#restart-update-button").disabled = false; showToast(error.message || "Could not restart to install update."); }
});
api.onUpdateStatus((status) => {
  if (!status || typeof status.message !== "string") return;
  $("#update-status").textContent = status.message;
  $("#restart-update-button").hidden = status.state !== "downloaded";
  $("#check-updates-button").disabled = ["checking", "downloading"].includes(status.state);
  if (status.state === "current") $("#check-updates-button").disabled = false;
  if (status.state === "error") $("#check-updates-button").disabled = false;
});
$("#save-launcher-settings").addEventListener("click", saveLauncherSettings);
$("#change-game-directory").addEventListener("click", changeLauncherDirectory);
$("#close-auth-dialog").addEventListener("click", cancelMicrosoftSignIn);
$("#cancel-auth").addEventListener("click", cancelMicrosoftSignIn);
$("#auth-dialog").addEventListener("cancel", (event) => { event.preventDefault(); cancelMicrosoftSignIn(); });
$("#copy-auth-code").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#auth-user-code").textContent); showToast("Sign-in code copied."); } catch { showToast("Select and copy the sign-in code."); } });
$("#open-auth-browser").addEventListener("click", async () => { try { await api.openMicrosoftVerification(state.verificationUri); } catch (error) { showToast(error.message || "Could not open Microsoft sign-in."); } });
$("#window-minimize").addEventListener("click", () => api.minimizeWindow());
$("#window-maximize").addEventListener("click", async () => {
  const maximized = await api.toggleMaximizeWindow();
  const button = $("#window-maximize");
  button.textContent = maximized ? "❐" : "□";
  button.title = maximized ? "Restore" : "Maximize";
  button.setAttribute("aria-label", button.title);
});
$("#window-close").addEventListener("click", () => api.closeWindow());

addLog("success", "Moon Launcher interface ready.");
loadVersions();
loadInstances();
loadSettings();
loadServers();
refreshAccountStatus();