/* global TimestampTrigger */
/* CPA Drill local re-engagement. Loaded by the generated service worker.
 * Keep quiet-hour constants in sync with src/core/reminders.js.
 */

const PLAN_URL = "https://cpa-drill.local/reminder-plan";
const TAG = "cpa-drill-reengage";
const PERIODIC = "cpa-drill-reengage";
const AFTER_MS = 20 * 60 * 60 * 1000;
const MIN_GAP_MS = 3 * 60 * 60 * 1000;
const QUIET_START = 22;
const QUIET_END = 7;
const WAKE_HOUR = 8;

const BODIES = [
  "Deal REG. The next pull is waiting.",
  "One more hand. The statute is on the other side.",
  "The hex map is still open. Deal REG.",
  "Chair time. Pull a near-level item.",
  "REG is still on the felt. Deal.",
  "The code did not move. You can. Deal REG.",
  "Quiet hours are over. Deal REG.",
  "Stay in the chair tomorrow. Deal REG tonight’s leftover.",
];

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
  const scope = self.registration.scope;
  const target = event.notification?.data?.url || scope;
  event.waitUntil(openDealTarget(target));
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
    if (!u.searchParams.get("deal")) u.searchParams.set("deal", "1");
    return u.href;
  } catch {
    return href;
  }
}

function pickBody(at) {
  const i = Math.abs(Math.floor(Number(at || Date.now()) / 3_600_000)) % BODIES.length;
  return BODIES[i];
}

function bumpQuiet(ms) {
  const d = new Date(ms);
  const hour = d.getHours();
  if (hour >= QUIET_START) {
    d.setDate(d.getDate() + 1);
    d.setHours(WAKE_HOUR, 0, 0, 0);
    return d.getTime();
  }
  if (hour < QUIET_END) {
    d.setHours(WAKE_HOUR, 0, 0, 0);
    return d.getTime();
  }
  return d.getTime();
}

async function openDealTarget(target) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (client.url && client.url.startsWith(self.registration.scope)) {
      try {
        client.postMessage({ type: "CPA_DRILL_OPEN", url: target });
      } catch {
        /* ignore */
      }
      if ("focus" in client) {
        try {
          if (typeof client.navigate === "function" && client.url.split("?")[0] !== String(target).split("?")[0]) {
            await client.navigate(target);
          }
        } catch {
          /* navigate is optional */
        }
        return client.focus();
      }
    }
  }
  if (self.clients.openWindow) return self.clients.openWindow(target);
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

async function saveAndArm(data) {
  const at = data.at;
  const plan = {
    at,
    lastActiveAt: data.lastActiveAt ?? Date.now(),
    title: data.title ?? "CPA Drill",
    body: data.body ?? pickBody(at),
    url: data.url ?? dealUrl(self.registration.scope),
    icon: data.icon ?? new URL("icons/icon-192.png", self.registration.scope).href,
    firedAt: null,
    channel: null,
  };
  await savePlan(plan);
  await closeTagged(TAG);
  if (typeof TimestampTrigger === "function" && Number.isFinite(plan.at) && plan.at > Date.now()) {
    try {
      await self.registration.showNotification(plan.title, {
        body: plan.body,
        tag: TAG,
        icon: plan.icon,
        badge: plan.icon,
        data: { url: plan.url },
        showTrigger: new TimestampTrigger(plan.at),
      });
      plan.channel = "timestamp";
      await savePlan(plan);
    } catch {
      /* Chromium-only; periodic sync / next wake still apply */
    }
  }
}

async function showDeal(plan) {
  await self.registration.showNotification(plan.title ?? "CPA Drill", {
    body: plan.body ?? pickBody(Date.now()),
    tag: TAG,
    icon: plan.icon,
    badge: plan.icon,
    data: { url: plan.url ?? dealUrl(self.registration.scope) },
  });
}

async function markFired(plan, now) {
  plan.firedAt = now;
  plan.at = bumpQuiet(now + AFTER_MS);
  plan.lastActiveAt = now;
  plan.channel = null;
  await savePlan(plan);
}

async function maybeNotifyFromPlan() {
  const plan = await readPlan();
  if (!plan || !Number.isFinite(plan.at)) return;
  const now = Date.now();
  if (now < plan.at) return;
  if (plan.firedAt != null && Number(plan.firedAt) >= Number(plan.at) - 1) return;
  if (now - (plan.lastActiveAt ?? 0) < MIN_GAP_MS) return;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const visible = windows.some((c) => c.visibilityState === "visible");
  if (visible) return;
  let alreadyShowing = false;
  try {
    const notes = await self.registration.getNotifications({ tag: TAG });
    alreadyShowing = notes.length > 0;
  } catch {
    alreadyShowing = false;
  }
  if (!alreadyShowing) {
    await showDeal(plan);
  }
  await markFired(plan, now);
}

async function handlePush(event) {
  let payload = {};
  try {
    payload = event.data ? await event.data.json() : {};
  } catch {
    try {
      payload = { body: event.data ? await event.data.text() : "" };
    } catch {
      payload = {};
    }
  }
  const plan = (await readPlan()) || {};
  const title = payload.title || plan.title || "CPA Drill";
  const body = payload.body || plan.body || pickBody(Date.now());
  const url = payload.url || payload.data?.url || plan.url || dealUrl(self.registration.scope);
  const icon = payload.icon || plan.icon || new URL("icons/icon-192.png", self.registration.scope).href;
  await self.registration.showNotification(title, {
    body,
    tag: TAG,
    icon,
    badge: icon,
    data: { url },
  });
}
