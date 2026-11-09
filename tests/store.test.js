const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");

global.crypto ??= webcrypto;

const storage = {};
global.chrome = {
  storage: {
    local: {
      get(keys, callback) {
        const names = Array.isArray(keys) ? keys : [keys];
        callback(Object.fromEntries(names.map((key) => [key, storage[key]])));
      },
      set(values, callback) {
        Object.assign(storage, values);
        callback?.();
      },
      remove(keys, callback) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        callback?.();
      }
    }
  }
};

require("../store.js");

test.beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
});

test("normalizes and deduplicates usernames", () => {
  assert.deepEqual(InstaStore.normalize([
    { username: " @Alice ", displayName: " Alice A. " },
    { username: "alice", displayName: "duplicate" },
    { username: "BOB" }
  ]), [
    { username: "alice", displayName: "Alice A.", avatar: "" },
    { username: "bob", displayName: "", avatar: "" }
  ]);
});

test("compares added and removed accounts", () => {
  const result = InstaStore.compare(
    [{ username: "alice" }, { username: "carol" }],
    [{ username: "alice" }, { username: "bob" }]
  );
  assert.deepEqual(result.added.map((person) => person.username), ["carol"]);
  assert.deepEqual(result.removed.map((person) => person.username), ["bob"]);
});

test("keeps dashboard snapshots isolated by active profile", async () => {
  await InstaStore.saveSnapshot({
    type: "followers",
    profileUsername: "alice",
    items: [{ username: "alice_fan" }]
  });
  await InstaStore.saveSnapshot({
    type: "followers",
    profileUsername: "bob",
    items: [{ username: "bob_fan" }]
  });

  const bob = await InstaStore.getDashboardData();
  assert.equal(bob.profile.username, "bob");
  assert.deepEqual(bob.currentFollowers.map((person) => person.username), ["bob_fan"]);
  assert.equal(bob.allSnapshots.length, 2);

  await InstaStore.set({ profile: { username: "alice" } });
  const alice = await InstaStore.getDashboardData();
  assert.deepEqual(alice.currentFollowers.map((person) => person.username), ["alice_fan"]);
});

test("restores a backup timestamp but always creates a fresh id", async () => {
  const createdAt = 1_700_000_000_000;
  const snapshot = await InstaStore.saveSnapshot({
    id: "untrusted-id",
    createdAt,
    type: "following",
    profileUsername: "alice",
    items: [{ username: "friend" }],
    source: "backup-import"
  });

  assert.equal(snapshot.createdAt, createdAt);
  assert.notEqual(snapshot.id, "untrusted-id");
});

test("blocks captures after critical Instagram safety signals", () => {
  const risk = InstaStore.assessRisk({
    requests: [],
    scrolls: [],
    captures: [],
    unfollows: [],
    signals: [
      { t: Date.now(), type: "throttle" },
      { t: Date.now(), type: "checkpoint" }
    ],
    cooldownUntil: 0
  });
  assert.equal(risk.blocked, true);
  assert.equal(risk.level, "critical");
});

test("blocks capture at the conservative ten-minute request ceiling", () => {
  const now = Date.now();
  const requests = Array.from({ length: InstaStore.REQUEST_LIMITS.perTenMinutes }, (_, index) => ({
    t: now - 90_000 - index * 1_000,
    kind: "request"
  }));
  const risk = InstaStore.assessRisk({
    requests,
    scrolls: [],
    captures: [],
    unfollows: [],
    signals: [],
    cooldownUntil: 0
  }, now);
  assert.equal(risk.volumeLimit, true);
  assert.equal(risk.blocked, true);
});

test("persists a long cooldown after an Instagram throttle signal", async () => {
  const before = Date.now();
  const risk = await InstaStore.recordEvents([{ kind: "signal", type: "throttle" }]);
  assert.equal(risk.blocked, true);
  assert.ok(risk.cooldownUntil >= before + 6 * 60 * 60 * 1000);
});
