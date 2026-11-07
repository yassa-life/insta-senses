let activeTab;
let activeProfile;
let latestRisk = null;

const $ = (selector) => document.querySelector(selector);

async function sendToTab(message) {
  if (!activeTab?.id) throw new Error("No active tab");
  return chrome.tabs.sendMessage(activeTab.id, message);
}

function renderRisk(risk) {
  latestRisk = risk;
  const card = $("#safetyCard");
  if (!risk || !card) return;
  card.dataset.level = risk.level || "low";
  $("#riskScore").textContent = `${risk.score}% ${risk.label || ""}`.trim();
  $("#riskFill").style.width = `${Math.max(8, risk.score || 0)}%`;
  $("#riskHelp").textContent = risk.advice;
}

async function init() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const buttons = [...document.querySelectorAll("[data-capture]")];
  try { renderRisk(await InstaStore.getRisk()); } catch { /* popup still works without risk */ }
  try {
    const result = await sendToTab({ type: "PING_INSTAGRAM" });
    activeProfile = result.profileUsername;
    if (result.risk) renderRisk(result.risk);
    if (activeProfile) {
      $("#status").textContent = "Instagram ready";
      $("#status").classList.add("online");
      $("#profileName").textContent = `@${activeProfile}`;
      $("#profileHelp").textContent = latestRisk?.blocked
        ? "Scanning is paused until this account cools down."
        : "Choose a list below. Keep Instagram open while the safer scan runs.";
      const { profile = {} } = await InstaStore.get(["profile"]);
      await InstaStore.set({ profile: { ...profile, username: activeProfile } });
    } else {
      $("#status").textContent = "Open a profile";
      $("#profileName").textContent = "Open an Instagram profile";
      $("#profileHelp").textContent = "Go to your profile page, then choose the list you want to capture.";
    }
    buttons.forEach((button) => (button.disabled = !activeProfile || Boolean(latestRisk?.blocked)));
  } catch {
    $("#status").textContent = "Open Instagram";
    buttons.forEach((button) => (button.disabled = true));
  }
}

document.querySelectorAll("[data-capture]").forEach((button) => {
  button.addEventListener("click", async () => {
    const listType = button.dataset.capture;
    if (!activeProfile) return;
    if (latestRisk?.blocked) {
      $("#profileHelp").textContent = latestRisk.advice;
      return;
    }
    button.disabled = true;
    const original = button.querySelector("b").textContent;
    button.querySelector("b").textContent = "Starting…";
    try {
      const result = await sendToTab({ type: "START_CAPTURE", listType, profileUsername: activeProfile, openList: true, autoScroll: true });
      if (result?.risk) renderRisk(result.risk);
      if (!result?.ok) throw new Error(result?.error || "Could not start capture");
      window.close();
    } catch (error) {
      button.disabled = Boolean(latestRisk?.blocked);
      button.querySelector("b").textContent = original;
      $("#profileHelp").textContent = error?.message || "Reload Instagram once, then try again.";
      document.querySelectorAll("[data-capture]").forEach((item) => {
        item.disabled = !activeProfile || Boolean(latestRisk?.blocked);
      });
    }
  });
});

$("#dashboardButton").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" }));
init();
