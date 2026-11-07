globalThis.InstaStore = (() => {
  const get = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  const set = (value) => new Promise((resolve) => chrome.storage.local.set(value, resolve));
  const remove = (keys) => new Promise((resolve) => chrome.storage.local.remove(keys, resolve));

  const normalizeUsername = (value = "") => String(value).trim().replace(/^@/, "").toLowerCase();

  const normalize = (items = []) => {
    const seen = new Set();
    return items
      .filter((item) => item?.username)
      .map((item) => ({
        username: normalizeUsername(item.username),
        displayName: String(item.displayName || "").trim(),
        avatar: String(item.avatar || "").trim()
      }))
      .filter((item) => item.username && !seen.has(item.username) && seen.add(item.username));
  };

  const latestOf = (snapshots, type) =>
    [...(snapshots || [])].filter((s) => s.type === type).sort((a, b) => b.createdAt - a.createdAt)[0];

  async function saveSnapshot(snapshot) {
    const items = normalize(snapshot.items);
    if (!items.length && snapshot.source !== "confirmed-unfollow") return null;
    const { snapshots = [], profile = {} } = await get(["snapshots", "profile"]);
    const profileUsername = normalizeUsername(snapshot.profileUsername || profile.username || "account");
    const requestedTime = Number(snapshot.createdAt);
    const next = {
      ...snapshot,
      id: crypto.randomUUID(),
      createdAt: Number.isFinite(requestedTime) && requestedTime > 0 ? requestedTime : Date.now(),
      profileUsername,
      items
    };
    const pruned = [...snapshots, next].sort((a, b) => b.createdAt - a.createdAt).slice(0, 80);
    const nextProfile = { ...profile, username: profileUsername };
    await set({ snapshots: pruned, profile: nextProfile });
    return next;
  }

  function compare(current = [], previous = []) {
    const currentMap = new Map(normalize(current).map((x) => [x.username, x]));
    const previousMap = new Map(normalize(previous).map((x) => [x.username, x]));
    return {
      added: [...currentMap.values()].filter((x) => !previousMap.has(x.username)),
      removed: [...previousMap.values()].filter((x) => !currentMap.has(x.username))
    };
  }

  async function getDashboardData() {
    const { snapshots = [], profile = {} } = await get(["snapshots", "profile"]);
    const activeUsername = normalizeUsername(profile.username);
    const accountSnapshots = activeUsername
      ? snapshots.filter((snapshot) => normalizeUsername(snapshot.profileUsername) === activeUsername)
      : snapshots;
    const followers = accountSnapshots.filter((s) => s.type === "followers").sort((a, b) => b.createdAt - a.createdAt);
    const following = accountSnapshots.filter((s) => s.type === "following").sort((a, b) => b.createdAt - a.createdAt);
    const currentFollowers = followers[0]?.items || [];
    const currentFollowing = following[0]?.items || [];
    const followerChange = compare(currentFollowers, followers[1]?.items || currentFollowers);
    const followingChange = compare(currentFollowing, following[1]?.items || currentFollowing);
    const followerNames = new Set(currentFollowers.map((x) => x.username));
    const followingNames = new Set(currentFollowing.map((x) => x.username));
    return {
      profile,
      snapshots: accountSnapshots,
      allSnapshots: snapshots,
      followers,
      following,
      currentFollowers,
      currentFollowing,
      followerChange,
      followingChange,
      notFollowingBack: currentFollowing.filter((x) => !followerNames.has(x.username)),
      youDoNotFollowBack: currentFollowers.filter((x) => !followingNames.has(x.username)),
      mutuals: currentFollowing.filter((x) => followerNames.has(x.username))
    };
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const emptyActivity = () => ({
    requests: [],
    scrolls: [],
    captures: [],
    unfollows: [],
    signals: [],
    cooldownUntil: 0
  });

  function pruneActivity(log = emptyActivity(), now = Date.now()) {
    const keep = (items, limit) => (items || []).filter((item) => now - item.t < DAY_MS).slice(-limit);
    return {
      requests: keep(log.requests, 400),
      scrolls: keep(log.scrolls, 400),
      captures: keep(log.captures, 40),
      unfollows: keep(log.unfollows, 80),
      signals: keep(log.signals, 40),
      cooldownUntil: Number(log.cooldownUntil) || 0
    };
  }

  function formatWait(ms) {
    const minutes = Math.max(1, Math.ceil(ms / 60000));
    return `${minutes} min`;
  }

  function assessRisk(log = emptyActivity(), now = Date.now()) {
    const data = pruneActivity(log, now);
    const countSince = (items, ms) => items.filter((item) => now - item.t < ms).length;
    const last60 = countSince(data.requests, 60 * 1000);
    const last10m = countSince(data.requests, 10 * 60 * 1000);
    const lastHour = countSince(data.requests, 60 * 60 * 1000);
    const scrolls10m = countSince(data.scrolls, 10 * 60 * 1000);
    const captures24 = data.captures.length;
    const unfollowsHour = countSince(data.unfollows, 60 * 60 * 1000);
    const recentThrottle = data.signals.some((item) => item.type === "throttle" && now - item.t < 30 * 60 * 1000);
    const recentCheckpoint = data.signals.some((item) => (item.type === "checkpoint" || item.type === "challenge") && now - item.t < 2 * 60 * 60 * 1000);
    const cooling = data.cooldownUntil > now;

    let score = 0;
    score += Math.min(32, last60 * 1.4);
    score += Math.min(22, last10m * 0.18);
    score += Math.min(12, lastHour * 0.05);
    score += Math.min(12, scrolls10m * 0.12);
    score += Math.min(12, captures24 * 3.5);
    score += Math.min(12, unfollowsHour * 4);
    if (recentThrottle) score += 38;
    if (recentCheckpoint) score += 50;
    if (cooling) score = Math.max(score, 78);
    score = Math.min(100, Math.round(score));

    const level = score < 25 ? "low" : score < 50 ? "moderate" : score < 75 ? "high" : "critical";
    const delayMs = level === "low" ? 2600 : level === "moderate" ? 4500 : level === "high" ? 8000 : 12000;
    const jitterMs = level === "low" ? 1400 : level === "moderate" ? 1800 : 2500;
    const blocked = level === "critical" || cooling;
    const waitMs = Math.max(0, data.cooldownUntil - now);
    const advice = blocked
      ? `Ban likelihood is high. Pause Instagram list loading for ${formatWait(waitMs || 20 * 60 * 1000)}. Import official JSON instead of scanning.`
      : level === "high"
        ? "Request volume is heavy. The scan will crawl slower, and huge lists are safer via JSON import."
        : level === "moderate"
          ? "Activity is picking up. Insta Senses is using a safer scroll pace."
          : "Pace looks close to normal browsing.";

    return {
      score,
      level,
      label: level === "low" ? "Low" : level === "moderate" ? "Moderate" : level === "high" ? "High" : "Critical",
      last60,
      last10m,
      lastHour,
      scrolls10m,
      captures24,
      unfollowsHour,
      delayMs,
      jitterMs,
      blocked,
      cooling,
      waitMs,
      cooldownUntil: data.cooldownUntil,
      advice
    };
  }

  async function loadActivity() {
    const { activityLog } = await get(["activityLog"]);
    return pruneActivity(activityLog);
  }

  async function recordEvents(events = []) {
    if (!events.length) return assessRisk(await loadActivity());
    const now = Date.now();
    const current = await loadActivity();
    for (const event of events) {
      const row = { t: event.t || now, ...event };
      if (event.kind === "request") current.requests.push(row);
      else if (event.kind === "scroll") current.scrolls.push(row);
      else if (event.kind === "capture") current.captures.push(row);
      else if (event.kind === "unfollow") current.unfollows.push(row);
      else if (event.kind === "signal") current.signals.push(row);
    }
    const risk = assessRisk(current, now);
    if (risk.level === "critical" && current.cooldownUntil < now) {
      current.cooldownUntil = now + 20 * 60 * 1000;
    }
    await set({ activityLog: pruneActivity(current, now) });
    return assessRisk(current, now);
  }

  async function getRisk() {
    return assessRisk(await loadActivity());
  }

  return { get, set, remove, saveSnapshot, compare, latestOf, getDashboardData, normalize, normalizeUsername, assessRisk, recordEvents, getRisk, loadActivity };
})();
