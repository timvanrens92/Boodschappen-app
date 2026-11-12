// Supabase Edge Function "notify"
// Stuurt een pushmelding naar de andere gezinsleden zodra er een product op een lijst komt.
// Wordt aangeroepen door een Database Webhook op INSERT in de tabel "items".
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:boodschappen@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const p = await req.json().catch(() => null);
  if (!p || p.type !== "INSERT" || p.table !== "items") return new Response("overgeslagen");

  const d = p.record?.data ?? {};
  const by: string | undefined = d.addedBy;

  let who = "Iemand";
  if (by) {
    const { data } = await sb.from("profiles").select("name").eq("id", by).maybeSingle();
    if (data?.name) who = data.name;
  }
  const listId = d.listId || "main";
  let listName = listId === "main" ? "Boodschappen" : "de lijst";
  const { data: l } = await sb.from("lists").select("data").eq("id", listId).maybeSingle();
  if (l?.data?.name) listName = l.data.name;

  let q = sb.from("push_subscriptions").select("endpoint, subscription, user_id");
  if (by) q = q.neq("user_id", by);
  const { data: subs } = await q;

  const qty = Number(d.qty) > 1 ? `${d.qty}× ` : "";
  const payload = JSON.stringify({
    title: listName,
    body: `${who} zette op de lijst: ${qty}${d.name ?? "iets nieuws"}`,
    tag: `bs-${listId}`,
  });

  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 6 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }));
  return new Response(`verstuurd naar ${subs?.length ?? 0}`);
});
