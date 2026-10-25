import webpush from "npm:web-push@3.6.7";

type Subscription = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
type Claimed = {
  enabled: boolean;
  publicKey?: string;
  privateKey?: string;
  eventKey?: string;
  body?: string;
  route?: string;
  entityId?: string | null;
  subscriptions?: Subscription[];
};
const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function validEventKey(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= 250 && /^[a-zA-Z0-9:_./-]+$/.test(s);
}
async function rpc<T>(fn: string, payload: Record<string, unknown>): Promise<T> {
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !secret) throw new Error("Missing Supabase server credentials");
  const response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // Never log credentials, subscription endpoints, or notification payloads.
    throw new Error(`Push database RPC failed (${response.status})`);
  }
  return await response.json() as T;
}

Deno.serve(async (req) => {
  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
    return json(200, { ok: true, service: "bb-web-push-dispatch-v1" });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const token = req.headers.get("x-bb-push-token") || "";
  if (token.length < 30) return json(403, { error: "Forbidden" });

  let eventKey: unknown;
  try {
    const request = await req.json();
    eventKey = request?.event_key;
  } catch {
    return json(400, { error: "Invalid request" });
  }
  if (!validEventKey(eventKey)) return json(400, { error: "Invalid event key" });
  let claim: Claimed;
  try {
    claim = await rpc<Claimed>("bb_push_claim_v1", {
      p_event_key: eventKey,
      p_token: token,
    });
  } catch {
    return json(403, { error: "Not authorized or unavailable" });
  }
  const subs = Array.isArray(claim.subscriptions) ? claim.subscriptions : [];
  if (!claim.enabled || subs.length === 0) {
    return json(200, { ok: true, sent: 0, ignored: true });
  }
  if (!claim.publicKey || !claim.privateKey) {
    return json(503, { error: "Push sender not configured" });
  }
  // Each push shows a visible alert; no silent/background client polling.
  const payload = JSON.stringify({
    title: "BIG BROTHER",
    body: String(claim.body || "Important business activity").slice(0, 220),
    tag: claim.eventKey,
    data: {
      route: claim.route,
      entityId: claim.entityId,
      eventKey: claim.eventKey,
    },
  });
  const results = await Promise.all(subs.map(async (s) => {
    try {
      const subscription = { endpoint: s.endpoint, keys: s.keys };
      const response = await webpush.sendNotification(subscription, payload, {
        TTL: 60 * 60 * 12,
        urgency: "normal",
        vapidDetails: {
          subject: "https://angsokhey11-cloud.github.io/big-brother-dashboard/",
          publicKey: claim.publicKey!,
          privateKey: claim.privateKey!,
        },
      });
      return { id: s.id, ok: true, gone: false, code: response.statusCode ?? 201 };
    } catch (error) {
      const code = typeof error === "object" && error !== null &&
        "statusCode" in error ? Number((error as { statusCode: number }).statusCode) : 0;
      return { id: s.id, ok: false, gone: code === 404 || code === 410, code };
    }
  }));
  try {
    await rpc("bb_push_finish_v1", {
      p_event_key: eventKey,
      p_token: token,
      p_results: results,
    });
  } catch {
    // Already sent messages must not be re-sent because bookkeeping failed.
    return json(207, {
      ok: false,
      sent: results.filter(x => x.ok).length,
      accounting: "unavailable",
    });
  }
  return json(200, {
    ok: true,
    sent: results.filter(x => x.ok).length,
    failed: results.filter(x => !x.ok).length,
  });
});
