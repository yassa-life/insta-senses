importScripts("store.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["settings"], ({ settings }) => {
    if (!settings) {
      chrome.storage.local.set({
        settings: { captureDelay: 900, privacyMode: true }
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_COMPLETE") {
    InstaStore.saveSnapshot({
      type: message.listType,
      profileUsername: message.profileUsername,
      items: message.items
    }).then((snapshot) => sendResponse({ ok: true, snapshotId: snapshot?.id || null }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "UNFOLLOW_CONFIRMED" && message.username) {
    InstaStore.get(["snapshots", "profile"]).then(async ({ snapshots = [], profile = {} }) => {
      const activeUsername = InstaStore.normalizeUsername(profile.username);
      const accountSnapshots = snapshots.filter((snapshot) =>
        InstaStore.normalizeUsername(snapshot.profileUsername) === activeUsername
      );
      const latest = InstaStore.latestOf(accountSnapshots, "following");
      if (!latest) {
        await InstaStore.remove("pendingUnfollow");
        sendResponse({ ok: false, error: "No following snapshot exists" });
        return;
      }
      const username = String(message.username).replace(/^@/, "").toLowerCase();
      const nextItems = latest.items.filter((person) => person.username.toLowerCase() !== username);
      if (nextItems.length !== latest.items.length) {
        await InstaStore.saveSnapshot({
          type: "following",
          profileUsername: latest.profileUsername || profile.username || "account",
          items: nextItems,
          source: "confirmed-unfollow"
        });
      }
      await InstaStore.remove("pendingUnfollow");
      sendResponse({ ok: true, updated: nextItems.length !== latest.items.length });
    }).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    sendResponse({ ok: true });
  }
  return true;
});
