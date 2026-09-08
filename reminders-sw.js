/* global TimestampTrigger */
/* CPA Drill local re-engagement. Loaded by the generated service worker. */

const PLAN_URL = "https://cpa-drill.local/reminder-plan";
const TAG = "cpa-drill-reengage";
const PERIODIC = "cpa-drill-reengage";

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const target = event.notification?.data?.url || scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== PERIODIC) return;
  event.waitUntil(maybeNotifyFromPlan());
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

self.addEventListener("activate", (event) => {
  event.waitUntil(maybeNotifyFromPlan());
});

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

async function saveAndArm(data) {
  const plan = {
    at: data.at,
    lastActiveAt: data.lastActiveAt ?? Date.now(),
    title: data.title ?? "CPA Drill",
    body: data.body ?? "Deal REG. The next pull is waiting.",
    url: data.url ?? self.registration.scope,
    icon: data.icon ?? new URL("icons/icon-192.png", self.registration.scope).href,
  };
  await savePlan(plan);
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
    } catch {
      /* Chromium-only; periodic sync / next wake still apply */
    }
  }
}

async function maybeNotifyFromPlan() {
  const plan = await readPlan();
  if (!plan || !Number.isFinite(plan.at)) return;
  const now = Date.now();
  if (now < plan.at) return;
  if (now - (plan.lastActiveAt ?? 0) < 3 * 60 * 60 * 1000) return;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const visible = windows.some((c) => c.visibilityState === "visible");
  if (visible) return;
  await self.registration.showNotification(plan.title, {
    body: plan.body,
    tag: TAG,
    icon: plan.icon,
    badge: plan.icon,
    data: { url: plan.url },
  });
  plan.at = now + 20 * 60 * 60 * 1000;
  plan.lastActiveAt = now;
  await savePlan(plan);
}
