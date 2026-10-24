const api = window.moonLauncher;
const state = { versions: [], instances: [], view: "home", toastTimer: null, activeInstall: null, account: null, settings: null, verificationUri: "", signInPromise: null };

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
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  $("#" + view + "-view").classList.add("active");
  const titles = {
    home: ["YOUR GAME LIBRARY", "Welcome to Moon"],
    modpacks: ["BROWSE AND IMPORT", "Modpacks"],
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
  $("#sign-in-button").hidden = Boolean(status?.signedIn);
  $("#sign-out-button").hidden = !status?.signedIn;
  if (status?.clientId !== undefined) $("#microsoft-client-id").value = status.clientId;
}

async function refreshAccountStatus() {
  try { renderAccount(await api.getAccountStatus()); }
  catch (error) { showToast(error.message || "Could not read the saved Minecraft account."); }
}

async function loadSettings() {
  try {
    state.settings = await api.getSettings();
    $("#game-directory-path").textContent = state.settings.gameDirectory;
    $("#memory-setting").value = String(state.settings.memoryGb);
    $("#connections-setting").value = String(state.settings.downloadConnections);
    $("#fullscreen-setting").checked = Boolean(state.settings.fullscreen);
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

async function saveClientId() {
  try {
    const result = await api.saveMicrosoftClientId($("#microsoft-client-id").value);
    $("#microsoft-client-id").value = result.clientId;
    await refreshAccountStatus();
    showToast(result.configured ? "Microsoft Application ID saved." : "Microsoft Application ID cleared.");
  } catch (error) {
    showToast(error.message || "Could not save the Microsoft Application ID.");
  }
}

function openAuthDialog() {
  $("#auth-status-message").textContent = "Starting secure Microsoft device sign-in…";
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
    message.textContent = "No modpacks found. Try another search.";
    host.append(message);
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

async function searchModpacks() {
  const query = $("#modpack-query").value.trim();
  const host = $("#modpack-results");
  host.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "search-message";
  loading.textContent = "Searching Modrinth…";
  host.append(loading);
  try {
    const projects = await api.searchModpacks(query);
    renderSearchResults(projects);
  } catch (error) {
    host.replaceChildren();
    const message = document.createElement("div");
    message.className = "search-message";
    message.textContent = error.message || "Modrinth search is unavailable.";
    host.append(message);
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
$("#new-instance").addEventListener("click", () => $("#instance-dialog").showModal());
$("#close-instance-dialog").addEventListener("click", () => $("#instance-dialog").close());
$("#instance-form").addEventListener("submit", createInstance);
$("#import-pack").addEventListener("click", importPack);
$("#import-pack-secondary").addEventListener("click", importPack);
$("#search-modpacks").addEventListener("click", searchModpacks);
$("#modpack-query").addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchModpacks();
});
$("#open-folder").addEventListener("click", () => api.openInstanceFolder());
$(".account-card").addEventListener("click", () => { if (state.account?.signedIn) setView("settings"); else startMicrosoftSignIn(); });
$(".account-card").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (state.account?.signedIn) setView("settings"); else startMicrosoftSignIn(); } });
$("#open-folder-settings").addEventListener("click", () => api.openInstanceFolder());
$("#save-client-id").addEventListener("click", saveClientId);
$("#open-app-registration").addEventListener("click", () => api.openMicrosoftRegistration().catch((error) => showToast(error.message)));
$("#sign-in-button").addEventListener("click", startMicrosoftSignIn);
$("#sign-out-button").addEventListener("click", async () => { try { await api.signOutMicrosoft(); await refreshAccountStatus(); showToast("Minecraft account signed out."); } catch (error) { showToast(error.message); } });
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
refreshAccountStatus();