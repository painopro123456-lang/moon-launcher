const api = window.moonLauncher;
const state = { versions: [], instances: [], view: "home", toastTimer: null, activeInstall: null, account: null, settings: null, verificationUri: "", signInPromise: null, servers: [], modsInstanceId: "", modpackPage: 1, modpackTotal: 0, modpackQuery: "", modpackRequestId: 0, modpacksLoaded: false };

const $ = (selector) => document.querySelector(selector);

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
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  $("#" + view + "-view").classList.add("active");
  const titles = {
    home: ["YOUR GAME LIBRARY", "Welcome to Moon"],
    modpacks: ["BROWSE AND IMPORT", "Modpacks"],
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

  $("#quick-play").disabled = !state.instances.some((item) => !(item.pack?.loader && item.pack.loader !== "Vanilla"));
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
    const isLoaderPack = Boolean(instance.pack?.loader && instance.pack.loader !== "Vanilla");
    launch.disabled = isLoaderPack;
    launch.title = isLoaderPack
      ? "This pack's mod loader is not supported yet."
      : "Install or launch this Minecraft instance.";
    launch.addEventListener("click", () => launchMinecraftInstance(instance.id, launch));

    card.append(top, title, detail, launch);
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
  const quickButton = $("#quick-play");
  if (state.instances[0]?.id === progress.instanceId || quickButton.dataset.instanceId === progress.instanceId) {
    if (progress.status === "running") { quickButton.textContent = "Minecraft running"; quickButton.disabled = true; }
    else if (["closed", "error"].includes(progress.status)) { quickButton.textContent = "▶ Quick Play"; quickButton.disabled = !state.instances.some((item) => !(item.pack?.loader && item.pack.loader !== "Vanilla")); delete quickButton.dataset.instanceId; }
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
  const detail = status?.signedIn ? "Minecraft account connected" : "Minecraft account";
  $(".account-card strong").textContent = name;
  $(".account-card span").textContent = detail;
  $(".avatar").textContent = status?.signedIn ? String(name || "M").slice(0, 1).toUpperCase() : "?";
  $("#settings-account-name").textContent = status?.signedIn ? "Signed in as " + name : "Not signed in";
  $("#settings-account-detail").textContent = status?.signedIn
    ? "This Microsoft account is ready for Minecraft."
    : "Sign in with the Microsoft account that owns Minecraft: Java Edition.";
  const clientInput = $("#microsoft-client-id");
  if (clientInput && typeof status?.clientId === "string" && clientInput.dataset.dirty !== "true") {
    clientInput.value = status.clientId;
    $("#microsoft-client-id-status").textContent = status.clientId ? "Client ID is saved on this PC." : "No client ID configured.";
  }
  $("#sign-in-button").hidden = Boolean(status?.signedIn);
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
      const option = new Option(account.username + (account.active ? " · Active" : ""), account.uuid);
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
    install.addEventListener("click", () => installModrinthPack(project, install));

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
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "secondary-button pagination-button";
  previous.textContent = "← Previous";
  previous.disabled = state.modpackPage <= 1;
  previous.addEventListener("click", () => searchModpacks(state.modpackPage - 1));
  const pageLabel = document.createElement("span");
  pageLabel.className = "pagination-page";
  pageLabel.textContent = `Page ${state.modpackPage} of ${totalPages.toLocaleString()}`;
  const next = document.createElement("button");
  next.type = "button";
  next.className = "secondary-button pagination-button";
  next.textContent = "Next →";
  next.disabled = state.modpackPage >= totalPages;
  next.addEventListener("click", () => searchModpacks(state.modpackPage + 1));
  controls.append(previous, pageLabel, next);
  host.append(summary, controls);
}

async function installModrinthPack(project, button) {
  if (state.activeInstall) {
    showToast("A modpack is already installing. Please wait for it to finish.");
    return;
  }

  state.activeInstall = { projectId: project.id, button };
  button.disabled = true;
  button.textContent = "Starting…";
  try {
    const instance = await api.installModrinthPack(project);
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
$("#new-instance").addEventListener("click", () => $("#instance-dialog").showModal());
$("#quick-play").addEventListener("click", () => {
  const instance = state.instances.find((item) => !(item.pack?.loader && item.pack.loader !== "Vanilla"));
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
$("#microsoft-client-id").addEventListener("input", () => { $("#microsoft-client-id").dataset.dirty = "true"; });
$("#save-microsoft-client-id").addEventListener("click", async () => {
  const input = $("#microsoft-client-id");
  const button = $("#save-microsoft-client-id");
  const status = $("#microsoft-client-id-status");
  try {
    button.disabled = true;
    status.textContent = "Saving client ID…";
    const result = await api.saveMicrosoftClientId(input.value.trim());
    input.value = result.clientId || "";
    input.dataset.dirty = "false";
    status.textContent = result.configured ? "Client ID saved. You can now try Microsoft sign-in." : "Client ID cleared.";
    showToast(result.configured ? "Microsoft client ID saved." : "Microsoft client ID cleared.");
  } catch (error) {
    status.textContent = error.message || "Could not save the client ID.";
    showToast(status.textContent);
  } finally {
    button.disabled = false;
  }
});
$("#open-microsoft-registration").addEventListener("click", async () => {
  try { await api.openMicrosoftRegistration(); }
  catch (error) { showToast(error.message || "Could not open Microsoft app registrations."); }
});
$("#sign-out-button").addEventListener("click", async () => { try { await api.signOutMicrosoft(); await refreshAccountStatus(); await loadSavedAccounts(); showToast("Signed out. Your saved account profiles remain available."); } catch (error) { showToast(error.message); } });
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

loadVersions();
loadInstances();
loadSettings();
loadServers();
refreshAccountStatus();