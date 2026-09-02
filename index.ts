import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);

Deno.serve(async () => {
  const today = new Date();
  today.setUTCHours(0,0,0,0);

  const ymd = (d: Date) => d.toISOString().slice(0,10);
  const todayStr = ymd(today);

  const { data: foods, error: foodError } = await supabase
    .from("food_items")
    .select("id,user_id,name,expiry_date");

  if (foodError) return new Response(foodError.message, {status:500});

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("*");

  const prefMap = new Map((prefs || []).map(p => [p.user_id, p]));
  let sent = 0;

  for (const food of foods || []) {
    const expiry = new Date(`${food.expiry_date}T00:00:00Z`);
    const diff = Math.round((expiry.getTime() - today.getTime()) / 86400000);
    const p = prefMap.get(food.user_id) ?? {
      days_7:true, days_3:true, days_1:true, same_day:true, expired:false
    };

    let key = "";
    if (diff === 7 && p.days_7) key = "7";
    if (diff === 3 && p.days_3) key = "3";
    if (diff === 1 && p.days_1) key = "1";
    if (diff === 0 && p.same_day) key = "0";
    if (diff < 0 && p.expired) key = "expired";

    if (!key) continue;

    const { data: already } = await supabase
      .from("notification_logs")
      .select("id")
      .eq("food_item_id", food.id)
      .eq("notice_key", key)
      .eq("notice_date", todayStr)
      .maybeSingle();

    if (already) continue;

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("user_id", food.user_id);

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: {p256dh: sub.p256dh, auth: sub.auth} },
          JSON.stringify({
            title: "🥬 食材期限リマインダー",
            body: diff < 0
              ? `「${food.name}」の期限が切れています。`
              : diff === 0
              ? `「${food.name}」の期限は今日です。`
              : `「${food.name}」の期限まであと${diff}日です。`,
            url: "/",
            tag: `food-${food.id}-${key}`
          })
        );
        sent++;
      } catch (e) {
        // 410/404等の無効な購読は削除
        const msg = String(e);
        if (msg.includes("410") || msg.includes("404")) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }

    await supabase.from("notification_logs").upsert({
      user_id: food.user_id,
      food_item_id: food.id,
      notice_key: key,
      notice_date: todayStr
    }, {onConflict:"food_item_id,notice_key,notice_date"});
  }

  return Response.json({ok:true, sent});
});
