const api = window.moonLauncher;
const state = { versions: [], instances: [], view: "home", toastTimer: null, activeInstall: null };

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
    const launch = document.createElement("button");
    launch.className = "launch-button";
    launch.textContent = "Launch not available yet";
    launch.disabled = true;
    launch.title = "Microsoft sign-in and game installation are not connected yet.";

    card.append(top, title, detail, launch);
    host.append(card);
  }
}

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
    showToast(instance.name + " files are ready. Minecraft and loader setup are still in progress.");
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
    showToast("Instance added. Game installation is still being connected.");
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
      showToast(instance.name + " files are ready. Minecraft and loader setup are still in progress.");
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
$("#open-folder-settings").addEventListener("click", () => api.openInstanceFolder());
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