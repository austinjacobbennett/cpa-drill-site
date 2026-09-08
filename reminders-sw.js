/* global TimestampTrigger */
/* CPA Drill local re-engagement. Loaded by the generated service worker.
 * Quiet hours are America/New_York (10pm–7am ET, wake 8am ET) — keep in
 * sync with src/core/reminders.js. No private keys. Optional `push` is a
 * client overlay when VAPID is present.
 */

const PLAN_URL = "https://cpa-drill.local/reminder-plan";
const TAG = "cpa-drill-reengage";
const PERIODIC = "cpa-drill-reengage";
const AFTER_MS = 20 * 60 * 60 * 1000;
const MIN_GAP_MS = 3 * 60 * 60 * 1000;
const QUIET_START = 22;
const QUIET_END = 7;
const WAKE_HOUR = 8;
const ET = "America/New_York";

const BODIES = [
  "Deal REG. The next pull is waiting.",
  "One more hand. The statute is on the other side.",
  "The hex map is still open. Deal REG.",
  "Chair time. Pull a near-level item.",
  "REG is still on the felt. Deal.",
  "The code did not move. You can. Deal REG.",
  "Quiet hours are over. Deal REG.",
  "Stay in the chair tomorrow. Deal REG tonight’s leftover.",
  "Yesterday’s rung is still warm. Deal REG.",
  "The map does not fill itself. Deal REG.",
  "Twenty hours. The next statute is yours.",
  "Come back colder or come back. Deal REG.",
  "Level bar is waiting. One productive pull.",
  "Study tone, not a streak app. Deal REG.",
  "The climb from last sit is still on the table.",
  "Sit down. One hand. Then another.",
  "The table is waiting. One productive pull.",
  "Same code. Fresh hand. Deal REG.",
];

const LEFTOVER = [
  "Tonight’s table is unpaid. Deal REG.",
  "Leftover hands on the felt. Deal REG.",
  "The table is still open. Sit down.",
  "You left mid-hand. Deal REG.",
  "Finish tonight’s table. Deal REG.",
];

const WARM = [
  "Table still warm. Deal REG.",
  "The felt is still hot. Sit back down.",
  "You left chips on the table. Deal REG.",
  "Ninety minutes. Leftover hands still on the felt. Deal REG.",
  "Chair’s still warm. One more hand.",
];

const STREAK = [
  "Return streak is on the felt. Deal REG.",
  "Today’s pip is still dark. Deal REG.",
  "Keep the chair-time streak. One pull.",
  "Yesterday counted. Sit down. Deal REG.",
];

const MORNING = [
  "Quiet hours are over. First pull is waiting.",
  "Morning Deal REG. Same Elo. Warm the chair.",
  "The table opened at 7am ET. Deal REG.",
  "First pull of the morning. Deal REG.",
  "8–10am window. First pull is waiting.",
];

const QUEST = [
  "Daily REG quest is unpaid. Deal REG.",
  "Today’s area quest is still on the felt.",
  "Three hands to clear the daily quest. Deal REG.",
  "Quest chip is waiting. Sit down.",
];

const FELT = [
  "Jackpot meter is still open. Deal REG.",
  "You left the felt mid-meter. One more hand.",
  "Unfinished pull on the felt. Deal REG.",
  "The meter survived overnight. Sit down.",
];

const HOLD = [
  "Hold is still armed. Deal REG.",
  "Combo hold is on the felt. Sit down.",
  "The next near-break keeps the heat. Deal REG.",
  "Streak hold is unpaid. Deal REG.",
];

const COLD = [
  "Unfinished hand. Deal REG.",
  "You left mid-hand. The code is still on the felt.",
  "The table waited. One more hand.",
  "Six hours. Same statute. Deal REG.",
];

const BOSS = [
  "Cold night cooled. Boss hand is optional. Deal REG.",
  "Comeback is on the felt. Deal the boss — or skip.",
  "Boss ladder’s open. One stretch pull. Deal REG.",
];

const SEED = [
  "Hex cells still dark. Deal REG.",
  "The seed map is unpaid. Light a cell.",
  "Chase the hex layer. Deal REG.",
  "Unfilled pairings on this seed. Deal REG.",
  "Crack the map. Same code. Deal REG.",
];

const BEAT = [
  "Beat yesterday’s morning. Deal REG.",
  "Yesterday’s climb is the mark. Deal REG.",
  "Morning board is unpaid. Deal REG.",
  "Stay ahead of yesterday-self. Deal REG.",
];

const EVENING = [
  "Evening REG. The table is open.",
  "Five to nine. Deal REG.",
  "Night table. One productive pull.",
  "Evening chair time. Deal REG.",
];

let firing = false;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([self.clients.claim(), maybeNotifyFromPlan()]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action || "";
  if (action === "dismiss" || action === "close") return;
  const dataAction = event.notification?.data?.action;
  const wantsDeal =
    action === "deal" || dataAction === "deal" || (!action && dataAction !== "enabled");
  const scope = self.registration.scope;
  const raw = event.notification?.data?.url || scope;
  event.waitUntil(openDealTarget(raw, wantsDeal));
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== PERIODIC) return;
  event.waitUntil(maybeNotifyFromPlan());
});

self.addEventListener("sync", (event) => {
  if (event.tag && event.tag !== PERIODIC) return;
  event.waitUntil(maybeNotifyFromPlan());
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription;
        if (oldSub && self.registration.pushManager) {
          const opts = oldSub.options || { userVisibleOnly: true };
          await self.registration.pushManager.subscribe(opts);
        }
      } catch {
        /* page will resubscribe on CPA_DRILL_PUSH_RESUBSCRIBE if a public key exists */
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({ type: "CPA_DRILL_PUSH_RESUBSCRIBE" });
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "CPA_DRILL_SCHEDULE") {
    event.waitUntil(saveAndArm(data));
  }
  if (data.type === "CPA_DRILL_CANCEL") {
    event.waitUntil(clearPlan());
  }
  if (data.type === "CPA_DRILL_CHECK") {
    event.waitUntil(maybeNotifyFromPlan());
  }
});

function dealUrl(href) {
  try {
    const u = new URL(href, self.registration.scope);
    u.searchParams.set("deal", "1");
    return u.href;
  } catch {
    return href;
  }
}

function namedOrFlavor(plan, at) {
  if (plan?.itchHint?.body) return plan.itchHint.body;
  return pickBody(at ?? plan?.at ?? Date.now(), plan?.flavor);
}

function zonedParts(ms) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = {};
  for (const part of dtf.formatToParts(new Date(ms))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function zonedLocalToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wanted;
  for (let i = 0; i < 3; i += 1) {
    const formatted = zonedParts(utc);
    const asUtc = Date.UTC(
      formatted.year,
      formatted.month - 1,
      formatted.day,
      formatted.hour,
      formatted.minute,
      formatted.second,
    );
    utc -= asUtc - wanted;
  }
  return utc;
}

function pickBody(at, flavor) {
  const list =
    flavor === "warm"
      ? WARM
      : flavor === "leftover"
        ? LEFTOVER
        : flavor === "streak"
          ? STREAK
          : flavor === "morning"
            ? MORNING
            : flavor === "quest"
              ? QUEST
              : flavor === "felt"
                ? FELT
                : flavor === "hold"
                  ? HOLD
                  : flavor === "cold"
                    ? COLD
                    : flavor === "boss"
                      ? BOSS
                      : flavor === "seed"
                        ? SEED
                        : flavor === "beat"
                          ? BEAT
                          : flavor === "evening"
                            ? EVENING
                            : BODIES;
  const ms = Number(at || Date.now());
  const p = zonedParts(ms);
  const day = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  let salt = 0;
  for (let i = 0; i < day.length; i += 1) salt = (salt * 33 + day.charCodeAt(i)) | 0;
  const i = Math.abs(Math.floor(ms / 3_600_000) + Math.abs(salt)) % list.length;
  return list[i];
}

function bumpQuiet(ms) {
  const p = zonedParts(ms);
  if (p.hour >= QUIET_START) {
    return zonedLocalToUtc({ year: p.year, month: p.month, day: p.day + 1, hour: WAKE_HOUR });
  }
  if (p.hour < QUIET_END) {
    return zonedLocalToUtc({ year: p.year, month: p.month, day: p.day, hour: WAKE_HOUR });
  }
  return ms;
}

function inQuiet(ms) {
  const hour = zonedParts(ms).hour;
  return hour >= QUIET_START || hour < QUIET_END;
}

async function openDealTarget(target, forceDeal = true) {
  const url = forceDeal ? dealUrl(target) : target;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (client.url && client.url.startsWith(self.registration.scope)) {
      try {
        client.postMessage({
          type: forceDeal ? "CPA_DRILL_OPEN" : "CPA_DRILL_FOCUS",
          url,
        });
      } catch {
        /* ignore */
      }
      if ("focus" in client) return client.focus();
    }
  }
  if (self.clients.openWindow) return self.clients.openWindow(url);
  return undefined;
}

async function planCache() {
  return caches.open("cpa-drill-reminders-v1");
}

async function savePlan(plan) {
  const cache = await planCache();
  await cache.put(PLAN_URL, new Response(JSON.stringify(plan)));
}

async function readPlan() {
  const cache = await planCache();
  const hit = await cache.match(PLAN_URL);
  if (!hit) return null;
  try {
    return await hit.json();
  } catch {
    return null;
  }
}

async function clearPlan() {
  const cache = await planCache();
  await cache.delete(PLAN_URL);
}

async function closeTagged(tag) {
  try {
    const notes = await self.registration.getNotifications({ tag });
    await Promise.all(notes.map((n) => n.close()));
  } catch {
    /* ignore */
  }
}

function noteTriggerAt(note) {
  const trigger = note?.showTrigger?.timestamp ?? note?.showTrigger ?? note?.data?.at;
  return Number(trigger);
}

function noteOptions(plan, extra = {}) {
  return {
    body: plan.body ?? namedOrFlavor(plan, plan.at ?? Date.now()),
    tag: TAG,
    icon: plan.icon,
    badge: plan.icon,
    data: { url: dealUrl(plan.url ?? self.registration.scope), action: "deal", at: plan.at ?? null },
    renotify: true,
    vibrate: [80, 40, 80],
    actions: [
      { action: "deal", title: "Deal REG" },
      { action: "dismiss", title: "Later" },
    ],
    ...extra,
  };
}

async function showTagged(title, options) {
  try {
    await self.registration.showNotification(title, options);
  } catch {
    const { actions, vibrate, renotify, ...rest } = options;
    await self.registration.showNotification(title, rest);
  }
}

async function armTimestamp(plan) {
  if (typeof TimestampTrigger !== "function") return false;
  if (!Number.isFinite(plan?.at) || plan.at <= Date.now()) return false;
  try {
    const notes = await self.registration.getNotifications({ tag: TAG });
    const matching = notes.some((n) => noteTriggerAt(n) === Number(plan.at));
    if (matching) return true;
    if (notes.length) await closeTagged(TAG);
    await showTagged(plan.title ?? "CPA Drill", noteOptions(plan, { showTrigger: new TimestampTrigger(plan.at) }));
    if (plan.channel !== "timestamp") {
      plan.channel = "timestamp";
      await savePlan(plan);
    }
    return true;
  } catch {
    return false;
  }
}

async function saveAndArm(data) {
  const at = data.at;
  const plan = {
    at,
    lastActiveAt: data.lastActiveAt ?? Date.now(),
    title: data.title ?? "CPA Drill",
    body: data.body ?? namedOrFlavor(data, at),
    url: dealUrl(data.url ?? self.registration.scope),
    icon: data.icon ?? new URL("icons/icon-192.png", self.registration.scope).href,
    firedAt: null,
    channel: null,
    flavor: data.flavor ?? data.itchHint?.flavor ?? null,
    itch: data.itch ?? data.itchHint?.flavor ?? null,
    itchHint: data.itchHint ?? null,
    areaId: data.areaId ?? data.itchHint?.areaId ?? null,
    lastFiredAt: data.lastFiredAt ?? null,
  };
  await savePlan(plan);
  await closeTagged(TAG);
  if (typeof TimestampTrigger === "function" && Number.isFinite(plan.at) && plan.at > Date.now()) {
    try {
      await showTagged(plan.title, noteOptions(plan, { showTrigger: new TimestampTrigger(plan.at) }));
      plan.channel = "timestamp";
      await savePlan(plan);
    } catch {
      /* Chromium-only; periodic sync / next wake still apply */
    }
  }
}

async function showDeal(plan) {
  await showTagged(plan.title ?? "CPA Drill", noteOptions(plan));
}

async function markFired(plan, now) {
  plan.firedAt = now;
  plan.lastFiredAt = now;
  plan.at = bumpQuiet(now + AFTER_MS);
  plan.lastActiveAt = now;
  plan.channel = null;
  await savePlan(plan);
}

async function askClientsForPlan() {
  try {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try {
        client.postMessage({ type: "CPA_DRILL_NEED_PLAN" });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

async function maybeNotifyFromPlan() {
  if (firing) return;
  firing = true;
  try {
    const plan = await readPlan();
    if (!plan || !Number.isFinite(plan.at)) {
      await askClientsForPlan();
      return;
    }
    const now = Date.now();
    if (now < plan.at) {
      await armTimestamp(plan);
      return;
    }
    if (plan.firedAt != null && Number(plan.firedAt) >= Number(plan.at) - 1) return;
    if (now - (plan.lastActiveAt ?? 0) < MIN_GAP_MS) return;
    if (Number(plan.lastFiredAt) > 0 && now - Number(plan.lastFiredAt) < MIN_GAP_MS) return;
    if (inQuiet(now)) {
      plan.at = bumpQuiet(now);
      await savePlan(plan);
      return;
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visible = windows.some((c) => c.visibilityState === "visible");
    if (visible) return;
    let alreadyShowing = false;
    try {
      const notes = await self.registration.getNotifications({ tag: TAG });
      alreadyShowing = notes.some((n) => {
        const triggerAt = noteTriggerAt(n);
        return !Number.isFinite(triggerAt) || triggerAt <= now;
      });
      if (!alreadyShowing && notes.length) await closeTagged(TAG);
    } catch {
      alreadyShowing = false;
    }
    if (!alreadyShowing) {
      await showDeal(plan);
    }
    await markFired(plan, now);
  } finally {
    firing = false;
  }
}

async function handlePush(event) {
  let payload = {};
  try {
    if (event.data && typeof event.data.json === "function") {
      payload = await event.data.json();
    }
  } catch {
    payload = {};
  }
  if (!payload || typeof payload !== "object" || !Object.keys(payload).length) {
    try {
      const text = event.data && typeof event.data.text === "function" ? await event.data.text() : "";
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { body: text };
        }
      }
    } catch {
      payload = {};
    }
  }
  const plan = (await readPlan()) || {};
  const title = payload.title || plan.title || "CPA Drill";
  const body =
    payload.body ||
    payload.itchHint?.body ||
    plan.body ||
    namedOrFlavor({ ...plan, itchHint: payload.itchHint || plan.itchHint }, Date.now());
  let url = payload.url || payload.data?.url || plan.url || self.registration.scope;
  try {
    const u = new URL(url, self.registration.scope);
    u.searchParams.set("deal", "1");
    const itch = payload.itch || payload.data?.itch || plan.itch || plan.itchHint?.flavor;
    const area = payload.area || payload.areaId || payload.data?.area || plan.areaId;
    if (itch) u.searchParams.set("itch", String(itch));
    if (area) u.searchParams.set("area", String(area));
    url = u.href;
  } catch {
    url = dealUrl(url);
  }
  const icon = payload.icon || plan.icon || new URL("icons/icon-192.png", self.registration.scope).href;
  try {
    await showTagged(title, noteOptions({ ...plan, title, body, url, icon }));
  } catch {
    try {
      await self.registration.showNotification(title, { body, icon, data: { url, action: "deal" } });
    } catch {
      /* local Notification path still works when the page is alive */
    }
  }
}
