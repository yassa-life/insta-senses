const state = { data: null, lists: {}, currentList: "mutuals", search: "" };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const formatDate = (timestamp) => new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(timestamp));

function compareAll(fromTime, toTime) {
  if (fromTime > toTime) [fromTime, toTime] = [toTime, fromTime];
  const snaps = state.data.snapshots;
  const nearest = (type, time) => [...snaps].filter((s) => s.type === type && s.createdAt <= time).sort((a,b)=>b.createdAt-a.createdAt)[0];
  const toFollowers = nearest("followers", toTime)?.items || [];
  const fromFollowers = nearest("followers", fromTime)?.items || toFollowers;
  const toFollowing = nearest("following", toTime)?.items || [];
  const fromFollowing = nearest("following", fromTime)?.items || toFollowing;
  const followerChange = InstaStore.compare(toFollowers, fromFollowers);
  const followingChange = InstaStore.compare(toFollowing, fromFollowing);
  return {
    newFollowers: followerChange.added,
    lostFollowers: followerChange.removed,
    newFollowing: followingChange.added,
    lostFollowing: followingChange.removed
  };
}

function renderStats() {
  const from = Number($("#fromSnapshot").value || 0);
  const to = Number($("#toSnapshot").value || Date.now());
  const changes = compareAll(from, to);
  state.lists = { ...state.lists, ...changes };
  $("#newFollowersStat").textContent = changes.newFollowers.length;
  $("#lostFollowersStat").textContent = changes.lostFollowers.length;
  $("#newFollowingStat").textContent = changes.newFollowing.length;
  $("#lostFollowingStat").textContent = changes.lostFollowing.length;
}

function renderPeople() {
  const labels = { newFollowers:"New followers",lostFollowers:"Lost followers",newFollowing:"New following",lostFollowing:"Lost following",notFollowingBack:"Don’t follow you back",youDoNotFollowBack:"You don’t follow back",mutuals:"Mutual connections",followers:"Followers",following:"Following" };
  $("#peopleTitle").textContent = labels[state.currentList] || "People";
  const list = (state.lists[state.currentList] || []).filter((p) => `${p.username} ${p.displayName}`.toLowerCase().includes(state.search));
  const canUnfollow = new Set(["notFollowingBack", "mutuals", "following", "newFollowing"]).has(state.currentList);
  $("#peopleList").innerHTML = list.length ? list.map((person) => `
    <article class="person">
      ${person.avatar ? `<img class="avatar" src="${escapeHtml(person.avatar)}" alt="@${escapeHtml(person.username)} profile picture" loading="lazy" referrerpolicy="no-referrer" data-initials="${escapeHtml(person.username.slice(0,2).toUpperCase())}">` : `<div class="avatar">${escapeHtml(person.username.slice(0,2).toUpperCase())}</div>`}
      <div class="person-copy"><b>@${escapeHtml(person.username)}</b><span>${escapeHtml(person.displayName || "Instagram account")}</span></div>
      <div class="person-actions">
        <a href="https://www.instagram.com/${encodeURIComponent(person.username)}/" target="_blank" rel="noreferrer">View profile ↗</a>
        ${canUnfollow ? `<button class="unfollow-button" data-unfollow="${escapeHtml(person.username)}">Unfollow</button>` : ""}
      </div>
    </article>`).join("") : `<div class="empty"><b>No accounts here</b>Capture both lists, or choose another category.</div>`;
  $("#peopleList").querySelectorAll("img.avatar").forEach((image) => {
    image.addEventListener("error", () => {
      const fallback = document.createElement("div");
      fallback.className = "avatar";
      fallback.textContent = image.dataset.initials || "IG";
      image.replaceWith(fallback);
    }, { once: true });
  });
}

function escapeHtml(value="") { const el=document.createElement("span"); el.textContent=value; return el.innerHTML; }

function showView(name) {
  $$(".view").forEach((view)=>view.classList.remove("active"));
  $$(".nav-item").forEach((item)=>{
    const active = item.dataset.view === name;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  $(`#${name}View`).classList.add("active");
}

function openList(name) { state.currentList=name; showView("people"); renderPeople(); }

function usernameFromExportRow(row) {
  const entry = row?.string_list_data?.[0] || row;
  const direct = entry?.value || entry?.username || row?.title || "";
  if (direct && !String(direct).startsWith("http")) return String(direct).replace(/^@/, "");
  const href = entry?.href || row?.href || "";
  try {
    return new URL(href).pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

function extractInstagramExport(json, filename) {
  const lowerName = filename.toLowerCase();
  let type = null;
  let rows = [];
  if (lowerName.includes("followers")) {
    type = "followers";
    rows = Array.isArray(json) ? json : (json.relationships_followers || []);
  } else if (lowerName.includes("following")) {
    type = "following";
    rows = Array.isArray(json) ? json : (json.relationships_following || []);
  }
  if (!type) return null;
  const items = rows.map((row) => ({
    username: usernameFromExportRow(row),
    displayName: "",
    avatar: ""
  })).filter((item) => item.username);
  return { type, items };
}

async function importInstagramFiles(files) {
  const grouped = { followers: [], following: [] };
  const backups = [];
  for (const file of files) {
    try {
      const json = JSON.parse(await file.text());
      if (Array.isArray(json?.snapshots)) {
        backups.push(...json.snapshots.filter((snapshot) =>
          ["followers", "following"].includes(snapshot?.type) && Array.isArray(snapshot.items)
        ));
        continue;
      }
      const parsed = extractInstagramExport(json, file.name);
      if (parsed) grouped[parsed.type].push(...parsed.items);
    } catch {
      // Skip unreadable files and keep importing the rest.
    }
  }
  const types = Object.keys(grouped).filter((type) => grouped[type].length);
  if (!types.length && !backups.length) throw new Error("No supported snapshot data found in these files");

  const existing = new Set((state.data.allSnapshots || state.data.snapshots).map((snapshot) =>
    [snapshot.profileUsername, snapshot.type, snapshot.createdAt, snapshot.items.length].join("|")
  ));
  let restored = 0;
  for (const snapshot of backups.sort((a, b) => a.createdAt - b.createdAt)) {
    const signature = [snapshot.profileUsername, snapshot.type, snapshot.createdAt, snapshot.items.length].join("|");
    if (existing.has(signature)) continue;
    const saved = await InstaStore.saveSnapshot({
      type: snapshot.type,
      profileUsername: snapshot.profileUsername || state.data.profile?.username || "account",
      items: snapshot.items,
      createdAt: snapshot.createdAt,
      source: "backup-import"
    });
    if (saved) {
      restored += 1;
      existing.add(signature);
    }
  }
  for (const type of types) {
    await InstaStore.saveSnapshot({
      type,
      profileUsername: state.data.profile?.username || "account",
      items: grouped[type]
    });
  }
  const summaries = types.map((type) => `${InstaStore.normalize(grouped[type]).length.toLocaleString()} ${type}`);
  if (restored) summaries.push(`${restored} backup snapshot${restored === 1 ? "" : "s"}`);
  if (backups.length && !restored) summaries.push("no new backup snapshots");
  return summaries.join(" and ");
}

async function init() {
  state.data = await InstaStore.getDashboardData();
  const d=state.data;
  state.lists={ notFollowingBack:d.notFollowingBack,youDoNotFollowBack:d.youDoNotFollowBack,mutuals:d.mutuals,followers:d.currentFollowers,following:d.currentFollowing };
  $("#heroUsername").textContent=d.profile?.username?`@${d.profile.username}`:"Your account";
  $("#followersCount").textContent=d.currentFollowers.length.toLocaleString();
  $("#followingCount").textContent=d.currentFollowing.length.toLocaleString();
  $("#mutualCount").textContent=d.mutuals.length.toLocaleString();
  $("#notBackStat").textContent=d.notFollowingBack.length;
  $("#youNotBackStat").textContent=d.youDoNotFollowBack.length;
  $("#mutualStat").textContent=d.mutuals.length;
  const times=[...new Set(d.snapshots.map((s)=>s.createdAt))].sort((a,b)=>a-b);
  const options=times.length?times.map((time)=>`<option value="${time}">${formatDate(time)}</option>`).join(""):`<option value="0">No snapshots yet</option>`;
  $("#fromSnapshot").innerHTML=options;
  $("#toSnapshot").innerHTML=options;
  if(times.length){$("#fromSnapshot").value=times[Math.max(0,times.length-2)];$("#toSnapshot").value=times.at(-1)}
  renderStats();
  const filters=[["mutuals","Mutuals"],["notFollowingBack","Not following back"],["youDoNotFollowBack","You don’t follow"],["followers","All followers"],["following","All following"]];
  $("#filterRow").innerHTML=filters.map(([key,label])=>`<button class="filter-chip ${key===state.currentList?"active":""}" data-filter="${key}">${label} · ${(state.lists[key]||[]).length}</button>`).join("");
  $("#historyList").innerHTML=d.snapshots.length?d.snapshots.sort((a,b)=>b.createdAt-a.createdAt).map((snap)=>`<article class="history-item"><span class="history-badge">${snap.type}</span><div class="history-copy"><b>@${escapeHtml(snap.profileUsername||d.profile?.username||"account")}</b><span>${formatDate(snap.createdAt)}</span></div><span class="history-count">${snap.items.length.toLocaleString()} accounts</span></article>`).join(""):`<div class="empty"><b>No captures yet</b>Open Instagram and capture a followers or following list.</div>`;
  renderPeople();
  renderSafety();
}

async function renderSafety() {
  const risk = await InstaStore.getRisk();
  const card = $("#safetyCard");
  if (!card) return;
  card.dataset.level = risk.level;
  $("#safetyScore").textContent = `${risk.score}% ${risk.label}`;
  $("#safetyFill").style.width = `${risk.score}%`;
  $("#safetyAdvice").textContent = risk.advice;
  $("#safetyRequests").textContent = risk.last10m;
  $("#safetyScans").textContent = risk.captures24;
  $("#safetyUnfollows").textContent = risk.unfollowsHour;
}

$$('.nav-item').forEach((button)=>button.addEventListener('click',()=>showView(button.dataset.view)));
$$('[data-list]').forEach((button)=>button.addEventListener('click',()=>openList(button.dataset.list)));
$("#fromSnapshot").addEventListener("change",renderStats);$("#toSnapshot").addEventListener("change",renderStats);
$("#searchInput").addEventListener("input",(e)=>{state.search=e.target.value.trim().toLowerCase();renderPeople()});
$("#peopleList").addEventListener("click",(event)=>{
  const button=event.target.closest("[data-unfollow]");
  if(!button)return;
  const username=button.dataset.unfollow;
  const confirmed=window.confirm(`Open @${username} on Instagram to unfollow? Instagram will show the final confirmation.`);
  if(confirmed){
    chrome.storage.local.set({pendingUnfollow:{username,createdAt:Date.now()}}).then(()=>{
      InstaStore.recordEvents([{ kind: "unfollow", username }]);
      window.open(`https://www.instagram.com/${encodeURIComponent(username)}/`,`_blank`);
    });
  }
});
$("#filterRow").addEventListener("click",(e)=>{const button=e.target.closest("[data-filter]");if(!button)return;state.currentList=button.dataset.filter;$$('.filter-chip').forEach((x)=>x.classList.toggle('active',x===button));renderPeople()});
$("#openInstagram").addEventListener("click",()=>window.open(`https://www.instagram.com/${state.data?.profile?.username||""}/`,"_blank"));
$("#importButton").addEventListener("click",()=>$("#importInput").click());
$("#importInput").addEventListener("change",async(e)=>{
  const help=$("#importHelp");
  try{
    help.className="import-help";help.textContent="Importing…";
    const summary=await importInstagramFiles([...e.target.files]);
    help.className="import-help success";help.textContent=`Imported ${summary}. Refreshing insights…`;
    setTimeout(()=>location.reload(),700);
  }catch(error){help.className="import-help error";help.textContent=error.message||"These files could not be imported."}
  e.target.value="";
});
$("#exportButton").addEventListener("click",()=>{
  const exportedAt = new Date();
  const payload = {
    format: "insta-senses-backup",
    version: 1,
    exportedAt: exportedAt.toISOString(),
    profile: state.data.profile,
    snapshots: state.data.snapshots
  };
  const blob = new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `insta-senses-${exportedAt.toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),0);
});
let refreshTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.snapshots) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => location.reload(), 500);
});
init();
