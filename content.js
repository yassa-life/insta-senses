(function () {
  let session = null;
  let observer = null;
  let panel = null;
  let scanTimer = null;
  let signalTimer = null;
  let refreshQueued = false;
  let pendingEvents = [];
  let flushTimer = null;
  let activeWarning = null;
  let latestRisk = { score: 0, level: "low", label: "Low", advice: "Measuring request volume…", blocked: false, waitMs: 0, delayMs: 2600, jitterMs: 1400 };

  const text = (el) => (el?.textContent || "").trim();
  const usernamePattern = /^[a-zA-Z0-9._]{1,30}$/;
  const reservedPaths = new Set([
    "explore", "accounts", "direct", "reels", "reel", "stories", "p", "tv",
    "about", "legal", "privacy", "directory", "nametag", "lite", "emailsignup",
    "developer", "session", "challenge", "web", "graphql", "api", "static",
    "tagged", "saved", "highlights"
  ]);
  const throttlePattern = /try again later|we limit how often|too many requests|please wait a few minutes|temporarily blocked|action blocked|slow down/i;
  const checkpointPattern = /confirm (it.?s|it's) you|suspicious activity|help us confirm|enter the code we sent|we noticed unusual/i;

  const normalizePath = (pathname) => (pathname || "/").replace(/\/+$/, "") || "/";

  function detectProfile() {
    const match = normalizePath(location.pathname).match(/^\/([^/]+)(?:\/(followers|following))?$/);
    if (!match || reservedPaths.has(match[1].toLowerCase())) return null;
    return match[1];
  }

  function looksLikeListApi(url) {
    if (/friendships\/.+\/(followers|following)/i.test(url)) return true;
    if (!/\/graphql|\/api\/v1\//i.test(url)) return false;
    const onListPage = /\/(followers|following)$/.test(normalizePath(location.pathname));
    const listOpen = onListPage && Boolean(document.querySelector('[role="dialog"]'));
    return Boolean(session) || listOpen;
  }

  function queueActivity(event) {
    pendingEvents.push(event);
    if (flushTimer) return;
    flushTimer = setTimeout(flushActivity, 1000);
  }

  async function flushActivity() {
    flushTimer = null;
    const events = pendingEvents;
    pendingEvents = [];
    if (!events.length || typeof InstaStore === "undefined") return;
    try {
      latestRisk = await InstaStore.recordEvents(events);
      renderRiskMeter();
      if (session && latestRisk.blocked) enterCooldown(latestRisk.advice);
    } catch {
      // Storage can fail if the extension was reloaded.
    }
  }

  function extractVisiblePeople() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const root = dialogs.at(-1);
    if (!root) return [];
    const found = new Map();
    root.querySelectorAll("a[href]").forEach((link) => {
      let path;
      try { path = new URL(link.href, location.origin).pathname; } catch { return; }
      const parts = normalizePath(path).split("/").filter(Boolean);
      if (parts.length !== 1) return;
      const username = parts[0];
      if (!usernamePattern.test(username || "")) return;
      if (reservedPaths.has(username.toLowerCase())) return;

      let row = link;
      for (let depth = 0; depth < 7 && row?.parentElement && row !== root; depth += 1) {
        row = row.parentElement;
        if (row.querySelector("img") && row.querySelectorAll("a[href]").length <= 3) break;
      }
      const images = [...(row?.querySelectorAll("img") || [])];
      const image = link.querySelector("img")
        || images.find((candidate) => (candidate.alt || "").toLowerCase().includes(username.toLowerCase()))
        || images[0];
      const labels = [...(row?.querySelectorAll("span, div") || [])]
        .map(text)
        .filter((label) => label && label !== username && label.length < 80 && !/^(follow|following|requested|remove|message)$/i.test(label));
      const displayName = labels.sort((a, b) => a.length - b.length)[0] || "";
      found.set(username.toLowerCase(), {
        username,
        displayName,
        avatar: image?.currentSrc || image?.src || image?.getAttribute("src") || ""
      });
    });
    return [...found.values()];
  }

  function renderRiskMeter() {
    if (!panel) return;
    const meter = panel.querySelector("[data-risk]");
    if (!meter) return;
    const score = latestRisk.score || 0;
    meter.dataset.level = latestRisk.level || "low";
    const scoreNode = panel.querySelector("[data-risk-score]");
    const fill = panel.querySelector("[data-risk-fill]");
    const note = panel.querySelector("[data-risk-note]");
    if (scoreNode) scoreNode.textContent = `${score}% ${latestRisk.label || ""}`.trim();
    if (fill) fill.style.width = `${score}%`;
    if (note) {
      note.textContent = latestRisk.blocked
        ? latestRisk.advice
        : latestRisk.level === "high"
          ? `Safer pace · ${latestRisk.last60 || 0} list requests / min`
          : latestRisk.advice;
    }
  }

  function refreshPanel() {
    if (!session || !panel) return;
    if (!session.paused && !session.cooldown) {
      extractVisiblePeople().forEach((person) => {
        const key = person.username.toLowerCase();
        const existing = session.people.get(key) || {};
        session.people.set(key, {
          ...existing,
          ...person,
          displayName: person.displayName || existing.displayName || "",
          avatar: person.avatar || existing.avatar || ""
        });
      });
    }
    const count = String(session.people.size);
    const countNode = panel.querySelector("[data-count]");
    if (countNode && countNode.textContent !== count) countNode.textContent = count;
    const status = panel.querySelector("[data-status]");
    if (!status) return;
    const nextStatus = session.cooldown
      ? `Cool-down · safety risk ${latestRisk.score}%`
      : session.paused
        ? `Paused · ${session.people.size} collected`
        : session.people.size
          ? "Scroll manually, then save when ready"
          : "Waiting for Instagram’s list…";
    if (status.textContent !== nextStatus) status.textContent = nextStatus;
    renderRiskMeter();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(() => {
      refreshQueued = false;
      refreshPanel();
    }, 180);
  }

  function cleanupCapture() {
    panel?.remove();
    observer?.disconnect();
    clearInterval(scanTimer);
    session = null;
    panel = null;
    observer = null;
    scanTimer = null;
  }

  function sendSnapshot(payload) {
    if (!payload?.items?.length) return;
    queueActivity({ kind: "capture", type: payload.listType, count: payload.items.length });
    flushActivity();
    try {
      chrome.runtime.sendMessage(payload);
    } catch {
      // Extension was reloaded while the Instagram tab stayed open.
    }
  }

  function takeSnapshotPayload() {
    if (!session) return null;
    refreshPanel();
    return {
      type: "CAPTURE_COMPLETE",
      listType: session.type,
      profileUsername: session.profileUsername,
      items: [...session.people.values()]
    };
  }

  function finishCapture() {
    const payload = takeSnapshotPayload();
    cleanupCapture();
    sendSnapshot(payload);
  }

  function cancelCapture() {
    cleanupCapture();
  }

  function pathsMatch(left, right) {
    return normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase();
  }

  function openInstagramList(type, profileUsername) {
    const wantedPath = `/${profileUsername}/${type}`;
    if (pathsMatch(location.pathname, wantedPath) && document.querySelector('[role="dialog"]')) return true;
    const link = [...document.querySelectorAll("a[href]")].find((candidate) => {
      try { return pathsMatch(new URL(candidate.href, location.origin).pathname, wantedPath); } catch { return false; }
    });
    if (!link) return false;
    link.click();
    return true;
  }

  function enterCooldown(reason) {
    if (!session) return;
    session.paused = true;
    session.cooldown = true;
    const button = panel?.querySelector("[data-pause]");
    if (button) {
      button.textContent = "Cool-down";
      button.disabled = true;
    }
    const status = panel?.querySelector("[data-status]");
    if (status) status.textContent = reason || `Cool-down · safety risk ${latestRisk.score}%`;
    renderRiskMeter();
  }

  function togglePause() {
    if (!session || session.cooldown) return;
    session.paused = !session.paused;
    const button = panel.querySelector("[data-pause]");
    button.textContent = session.paused ? "Resume" : "Pause";
    panel.querySelector("[data-status]").textContent = session.paused
      ? `Paused · ${session.people.size} collected`
      : "Scroll manually, then save when ready";
  }

  function buildPanel(title, statusText) {
    panel = document.createElement("aside");
    panel.className = "is-capture-panel";
    panel.setAttribute("aria-label", "Insta Senses capture");
    panel.innerHTML = `
      <div class="is-capture-main">
        <div class="is-capture-mark">IS</div>
        <div class="is-capture-copy"><strong>${title}</strong><span><b data-count>0</b> unique accounts seen</span><small data-status aria-live="polite">${statusText}</small></div>
        <div class="is-capture-actions"><button class="is-pause" data-pause>Pause</button><button class="is-cancel" data-cancel>Cancel</button><button data-finish>Save</button></div>
      </div>
      <div class="is-risk" data-risk data-level="low">
        <div class="is-risk-top"><span>Account-safety risk</span><b data-risk-score>0% Low</b></div>
        <div class="is-risk-bar"><i data-risk-fill></i></div>
        <small data-risk-note>Watching Instagram list requests from this tab…</small>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector("[data-finish]").addEventListener("click", finishCapture);
    panel.querySelector("[data-cancel]").addEventListener("click", cancelCapture);
    panel.querySelector("[data-pause]").addEventListener("click", togglePause);
  }

  async function startCapture(type, profileUsername, shouldOpenList = false) {
    if (session) {
      const payload = takeSnapshotPayload();
      cleanupCapture();
      sendSnapshot(payload);
    }
    if (typeof InstaStore !== "undefined") {
      try { latestRisk = await InstaStore.getRisk(); } catch { /* keep last risk */ }
    }
    session = { type, profileUsername, people: new Map(), paused: false, cooldown: false };
    buildPanel(`Capturing ${type}`, latestRisk.blocked ? "Scan paused for account safety" : "Opening Instagram’s list…");
    if (latestRisk.blocked) {
      enterCooldown(latestRisk.advice);
    }
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => !panel?.contains(mutation.target))) queueRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scanTimer = setInterval(refreshPanel, 800);
    if (!latestRisk.blocked && shouldOpenList && !openInstagramList(type, profileUsername)) {
      panel.querySelector("[data-status]").textContent = `Click ${type} on the profile, then scroll`;
    }
    refreshPanel();
  }

  function inspectInstagramSignals() {
    const visible = `${document.title} ${text(document.querySelector("main"))} ${text(document.querySelector('[role="dialog"]'))}`.slice(0, 4000);
    if (checkpointPattern.test(visible)) {
      latestRisk = { ...latestRisk, score: Math.max(latestRisk.score, 92), level: "critical", label: "Critical", blocked: true, advice: "Instagram asked for a security check. Stop scanning and wait before loading more lists." };
      if (activeWarning !== "checkpoint") queueActivity({ kind: "signal", type: "checkpoint" });
      activeWarning = "checkpoint";
      if (session) enterCooldown(latestRisk.advice);
      return;
    }
    if (throttlePattern.test(visible)) {
      latestRisk = { ...latestRisk, score: Math.max(latestRisk.score, 80), level: "critical", label: "Critical", blocked: true, advice: "Instagram is throttling this account. Cool down before any more list requests." };
      if (activeWarning !== "throttle") queueActivity({ kind: "signal", type: "throttle" });
      activeWarning = "throttle";
      if (session) enterCooldown(latestRisk.advice);
      return;
    }
    activeWarning = null;
  }

  function watchForConfirmedUnfollow() {
    chrome.storage.local.get(["pendingUnfollow"], ({ pendingUnfollow }) => {
      if (!pendingUnfollow || Date.now() - pendingUnfollow.createdAt > 15 * 60 * 1000) {
        if (pendingUnfollow) chrome.storage.local.remove("pendingUnfollow");
        return;
      }
      const pageUsername = location.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
      if (pageUsername !== pendingUnfollow.username.toLowerCase()) return;

      let sawFollowing = false;
      let checks = 0;
      const checkState = () => {
        checks += 1;
        const profileHeader = document.querySelector("main header, [role='main'] header");
        const buttonLabels = [...(profileHeader?.querySelectorAll("button, [role='button']") || [])]
          .map((button) => text(button).replace(/\s+/g, " "))
          .filter((label) => label.length < 40);
        if (buttonLabels.some((label) => /^(following|requested)\b/i.test(label))) sawFollowing = true;
        if (sawFollowing && buttonLabels.some((label) => /^follow$/i.test(label))) {
          clearInterval(watcher);
          try {
            chrome.runtime.sendMessage({ type: "UNFOLLOW_CONFIRMED", username: pendingUnfollow.username });
          } catch {
            chrome.storage.local.remove("pendingUnfollow");
          }
          return;
        }
        if (checks >= 900) clearInterval(watcher);
      };
      const watcher = setInterval(checkState, 1000);
      checkState();
    });
  }

  function startRequestWatch() {
    try {
      const performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (looksLikeListApi(entry.name)) queueActivity({ kind: "request", source: "network" });
        }
      });
      performanceObserver.observe({ type: "resource", buffered: true });
    } catch {
      // PerformanceObserver is unavailable in some edge cases.
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "PING_INSTAGRAM") {
      const reply = () => sendResponse({ ok: true, profileUsername: detectProfile(), risk: latestRisk });
      if (typeof InstaStore === "undefined") {
        reply();
        return;
      }
      InstaStore.getRisk().then((risk) => {
        latestRisk = risk;
        sendResponse({ ok: true, profileUsername: detectProfile(), risk });
      }).catch(reply);
      return true;
    }
    if (message?.type === "START_CAPTURE") {
      const profileUsername = message.profileUsername || detectProfile();
      if (!profileUsername) {
        sendResponse({ ok: false, error: "Open an Instagram profile first" });
        return;
      }
      const begin = async () => {
        if (typeof InstaStore !== "undefined") {
          try { latestRisk = await InstaStore.getRisk(); } catch { /* continue */ }
        }
        if (latestRisk.blocked) {
          await startCapture(message.listType, profileUsername, false);
          sendResponse({
            ok: false,
            error: latestRisk.advice,
            risk: latestRisk
          });
          return;
        }
        await startCapture(message.listType, profileUsername, message.openList === true);
        sendResponse({ ok: true, risk: latestRisk });
      };
      begin();
      return true;
    }
    if (message?.type === "STOP_CAPTURE") {
      finishCapture();
      sendResponse({ ok: true });
    }
  });

  startRequestWatch();
  inspectInstagramSignals();
  signalTimer = setInterval(inspectInstagramSignals, 4000);
  watchForConfirmedUnfollow();
  if (typeof InstaStore !== "undefined") {
    InstaStore.getRisk().then((risk) => { latestRisk = risk; }).catch(() => {});
  }

})();
