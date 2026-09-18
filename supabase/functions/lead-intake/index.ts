// lead-intake — flerkunds leadgen-webhook för Meta-snabbformulär.
//
// Skillnaden mot meta-leads-webhook: ingen kund är hårdkodad. Tenanten slås upp
// på Metas page_id i tabellen meta_lead_routes, och samma tabell bär kundens
// fältmappning. En ny kund är en rad i databasen, inte en ny deploy.
//
// GET  : Metas verifiering (hub.mode / hub.verify_token / hub.challenge)
//        ?routes=1 — hälsokoll, vilka sidor är inkopplade
// POST : leadgen-händelser → Graph API → ce_leads → ce_lead_events → SMS
//        ?backfill=1 — hämtar befintliga leads ur Metas Leadcenter för en sida
//        som kopplades in efter att annonsen redan börjat leverera. Autentiseras
//        med tjänstenyckeln som Bearer, inte med Metas signatur. Tyst som
//        standard (inga SMS på gamla leads), idempotent på dedupe_key.
//
// Idempotent på dedupe_key = "leadgen:<id>". Meta skickar om vid icke-2xx, så vi
// svarar 200 så snart payloaden är giltig och gör jobbet i EdgeRuntime.waitUntil.
// Ett okänt page_id loggas och ignoreras — det är inte ett fel, det betyder att
// någon kopplat en sida vi inte tagit emot ännu.
//
// Secrets:
//   META_APP_SECRETS   – kommaseparerade app-hemligheter, en per kundapp
//   META_APP_SECRET    – enstaka hemlighet, alternativ till ovan
//   META_VERIFY_TOKEN  – samma sträng som i Metas webhook-dialog
//   META_PAGE_TOKEN    – systemanvändartoken med leads_retrieval
//   ELKS_USER/ELKS_PASS – 46elks, för notis-SMS (valfritt)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Typen kommer från Supabases runtime. Den deklareras här också så att
// `deno check` går att köra lokalt utan deras körmiljö.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const GRAPH = "https://graph.facebook.com/v21.0";

const supabase = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

// ---------- signatur ----------

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- routing ----------

interface Route {
  page_id: string;
  tenant_id: string;
  page_name: string | null;
  config: {
    field_map?: Record<string, string[]>;
    hot_when?: Record<string, string[]>;
    hot_free_text?: boolean;
    notify?: { sms_to?: string[]; sms_from?: string };
    sms?: {
      active?: boolean;
      from?: string;
      quiet?: { from: number; to: number };
      steps?: Array<{ delay_min: number; text: string }>;
    };
  };
}

async function routeFor(pageId?: string): Promise<Route | null> {
  if (!pageId) return null;
  const { data, error } = await supabase
    .from("meta_lead_routes")
    .select("page_id,tenant_id,page_name,config")
    .eq("page_id", String(pageId))
    .eq("active", true)
    .maybeSingle();
  if (error) { console.error("routeFor", error.message); return null; }
  return (data as Route) ?? null;
}

// ---------- fältmappning ----------

function normalizePhone(p?: string): string | null {
  if (!p) return null;
  let s = p.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) s = "+" + s;
  return s.length >= 8 ? s : null;
}

// Metas field_data har kundens egna fältnamn. Mappningen kommer från routingraden,
// så koden behöver aldrig känna till en enskild kunds formulär.
function mapFields(
  fieldData: Array<{ name: string; values: string[] }>,
  fieldMap: Record<string, string[]>,
): { values: Record<string, string>; raw: Record<string, string> } {
  const raw: Record<string, string> = {};
  const values: Record<string, string> = {};
  for (const f of fieldData ?? []) {
    const namn = (f.name ?? "").toLowerCase();
    const val = (f.values ?? []).join(", ").trim();
    raw[f.name] = val;
    for (const [nyckel, monster] of Object.entries(fieldMap)) {
      if (values[nyckel] !== undefined) continue;          // första träffen vinner
      if (monster.some((m) => namn.includes(m.toLowerCase()))) { values[nyckel] = val; break; }
    }
  }
  return { values, raw };
}

function isTestLead(raw: Record<string, string>, namn?: string): boolean {
  return Object.values(raw).some((v) => /test lead|dummy data/i.test(v)) || /^test\b/i.test(namn ?? "");
}

// "Het" ska betyda något. Triggar den på nästan alla leads är den bara brus, och
// då är det bättre att allt landar i Ny och sorteras av den som ringer. Därför är
// båda reglerna avstängda om inte kundens config uttryckligen slår på dem.
function hotReasonsFor(
  values: Record<string, string>,
  hotWhen: Record<string, string[]>,
  hotFreeText = false,
): string[] {
  const skal: string[] = [];
  for (const [nyckel, traffar] of Object.entries(hotWhen ?? {})) {
    const v = (values[nyckel] ?? "").toLowerCase().trim();
    if (v && traffar.some((t) => v === t.toLowerCase() || v.startsWith(t.toLowerCase()))) {
      skal.push(`form_${nyckel}`);
    }
  }
  if (hotFreeText) {
    for (const [nyckel, v] of Object.entries(values)) {
      if (nyckel !== "full_name" && nyckel !== "phone" && nyckel !== "email" && v.length > 25) {
        skal.push("form_free_text");
        break;
      }
    }
  }
  return [...new Set(skal)];
}

// ---------- Graph ----------

async function fetchLead(leadgenId: string) {
  const token = env("META_PAGE_TOKEN");
  if (!token) throw new Error("META_PAGE_TOKEN saknas");
  const url = `${GRAPH}/${leadgenId}?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,` +
    `campaign_id,campaign_name,form_id,platform,is_organic,field_data&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Graph ${r.status}: ${JSON.stringify(j.error ?? j)}`);
  return j;
}

// ---------- SMS ----------

async function sendSms(to: string, from: string, message: string): Promise<{ id?: string; error?: string }> {
  const user = env("ELKS_USER"), pass = env("ELKS_PASS");
  if (!user || !pass) return { error: "ELKS_USER/ELKS_PASS saknas" };
  // Alfanumerisk avsändare får vara max 11 tecken. Ett riktigt nummer får INTE
  // kapas — då blir det ett annat nummer och 46elks avvisar utskicket.
  const avsandare = /^\+?\d{6,15}$/.test(from) ? from : from.slice(0, 11);
  const body = new URLSearchParams({ from: avsandare, to, message });
  const r = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${user}:${pass}`) },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `46elks ${r.status}: ${JSON.stringify(j)}` };
  return { id: j.id };
}

function smsText(p: {
  namn: string; telefon: string | null; hett: boolean; test: boolean;
  fritext?: string; sida?: string | null;
}): string {
  const rader = [
    `${p.test ? "[TEST] " : ""}Nytt lead${p.hett ? " 🔥" : ""}${p.sida ? " · " + p.sida : ""}`,
    p.namn,
  ];
  if (p.telefon) rader.push(p.telefon);
  const m = (p.fritext ?? "").trim();
  if (m && !/^(nej|no|none|-)$/i.test(m)) rader.push(`"${m.slice(0, 110)}${m.length > 110 ? "…" : ""}"`);
  return rader.join("\n").slice(0, 300);
}

// ---------- kärnan ----------

// upsertLead tar ett redan hämtat lead från Graph. Webhooken hämtar det på id,
// backfillen läser det ur formulärets leadlista. Allt efter hämtningen är
// identiskt, så den vägen finns bara på ett ställe.
async function upsertLead(
  route: Route,
  lead: any,
  opts: { notify?: boolean; ad_id?: string; adgroup_id?: string; form_id?: string } = {},
): Promise<"inserted" | "merged" | "duplicate"> {
  const notify = opts.notify !== false;
  const leadgenId = String(lead.id);
  const dedupe = `leadgen:${leadgenId}`;
  const tenant = route.tenant_id;
  const v = { ad_id: opts.ad_id, adgroup_id: opts.adgroup_id, form_id: opts.form_id };

  const { data: fanns } = await supabase.from("ce_leads").select("id")
    .eq("tenant_id", tenant).eq("dedupe_key", dedupe).maybeSingle();
  if (fanns) { console.log("dup", dedupe); return "duplicate"; }

  const fieldMap = route.config?.field_map ?? {
    full_name: ["full_name", "namn", "name"],
    phone: ["phone", "telefon"],
    email: ["email", "e-post", "epost"],
  };
  const { values, raw } = mapFields(lead.field_data, fieldMap);

  const test = isTestLead(raw, values.full_name);
  const telefon = normalizePhone(values.phone);
  const epost = (values.email ?? "").trim().toLowerCase() || null;
  const fulltNamn = (values.full_name ?? "").trim() || "Okänt namn";
  const skal = hotReasonsFor(
    values,
    route.config?.hot_when ?? {},
    route.config?.hot_free_text === true,
  );
  const hett = skal.length > 0;

  // Fritexten är det Joakim faktiskt läser innan han ringer. Vi plockar det
  // längsta svaret som inte är namn, telefon eller e-post.
  const fritext = Object.entries(values)
    .filter(([k]) => !["full_name", "phone", "email"].includes(k))
    .map(([, v2]) => v2)
    .sort((a, b) => b.length - a.length)[0];

  const row = {
    tenant_id: tenant,
    name: fulltNamn,
    phone: telefon,
    email: epost,
    language: "sv",
    source: "lead_ads",
    channel: "other",
    ad_id: lead.ad_id ?? v.ad_id ?? null,
    campaign_id: lead.campaign_id ?? null,
    ad_referral: {
      ad_name: lead.ad_name, adset_id: lead.adset_id ?? v.adgroup_id, adset_name: lead.adset_name,
      campaign_name: lead.campaign_name, form_id: lead.form_id ?? v.form_id,
      platform: lead.platform, is_organic: lead.is_organic, page_id: route.page_id,
    },
    qualification: { form: raw, mapped: values, message: fritext ?? null },
    hot_reasons: skal,
    status: "new",
    hot_at: hett ? new Date().toISOString() : null,
    custom: {
      priority: hett ? "hot" : "warm",
      test,
      leadgen_id: leadgenId,
      meta_created_time: lead.created_time,
      page_id: route.page_id,
    },
    dedupe_key: dedupe,
  };

  let leadId: string | null = null;
  let utfall: "inserted" | "merged" = "inserted";
  const ins = await supabase.from("ce_leads").insert(row).select("id").single();
  if (ins.error) {
    // Unikt index på telefon: samma person hör av sig igen. Uppdatera i stället
    // för att skapa ett andra kort som ingen tittar på.
    if (ins.error.code === "23505" && telefon) {
      const upd = await supabase.from("ce_leads").update({
        email: epost ?? undefined, qualification: row.qualification,
        hot_reasons: skal, custom: row.custom, dedupe_key: dedupe,
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenant).eq("phone", telefon).select("id").single();
      if (upd.error) throw upd.error;
      leadId = upd.data.id;
      utfall = "merged";
      console.log("slogs ihop på telefon", telefon, leadId);
    } else if (ins.error.code === "23505") {
      console.log("dup race", dedupe); return "duplicate";
    } else throw ins.error;
  } else leadId = ins.data.id;

  await supabase.from("ce_lead_events").insert({
    tenant_id: tenant, lead_id: leadId, event_type: "form_received", to_status: "new",
    actor: "system",
    payload: { source: "lead_ads", leadgen_id: leadgenId, page_id: route.page_id, hot: hett, test },
  });

  const mottagare = notify && !test ? (route.config?.notify?.sms_to ?? []) : [];
  const avsandare = route.config?.notify?.sms_from ?? "Skyland";
  const text = smsText({
    namn: fulltNamn, telefon, hett, test, fritext, sida: route.page_name,
  });
  for (const to of mottagare) {
    const r = await sendSms(to, avsandare, text);
    if (r.error) console.error("sms misslyckades", to, r.error);
    else await supabase.from("ce_lead_events").insert({
      tenant_id: tenant, lead_id: leadId, event_type: "owner_notified",
      actor: "system", payload: { via: "sms", to, id: r.id },
    });
  }

  // Backfill av gamla leads köar inget: notify=false betyder att leadet redan
  // hunnit kallna och ska ringas för hand, inte få ett sms dagar i efterhand.
  if (notify && !test && telefon && leadId) {
    await koaSms(route, leadId, telefon, fulltNamn, 1);
  }

  console.log("lead ok", route.page_name ?? route.page_id, leadId, hett ? "HET" : "", test ? "TEST" : "");
  return utfall;
}

async function processLeadgen(v: {
  leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string;
  adgroup_id?: string; created_time?: number;
}, opts: { notify?: boolean } = {}) {
  const leadgenId = String(v.leadgen_id);
  const route = await routeFor(v.page_id);
  if (!route) { console.log("ingen route för page_id", v.page_id, "— hoppar över", leadgenId); return; }

  const { data: fanns } = await supabase.from("ce_leads").select("id")
    .eq("tenant_id", route.tenant_id).eq("dedupe_key", `leadgen:${leadgenId}`).maybeSingle();
  if (fanns) { console.log("dup", leadgenId); return; }

  const lead = await fetchLead(leadgenId);
  await upsertLead(route, lead, {
    notify: opts.notify, ad_id: v.ad_id, adgroup_id: v.adgroup_id, form_id: v.form_id,
  });
}

// ---------- SMS-uppföljning till leadet ----------

// Kursupplägget vi kör efter: leadet ska höra av oss inom 5-10 minuter, sedan med
// glesare mellanrum tills det svarar. Kön ligger i lead_sms_outbox eftersom en
// edge function inte kan sova; pg_cron knackar varje minut på ?run_sms=1.

function stockholmTimme(d: Date): number {
  return Number(new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false,
  }).format(d));
}

// Ingen väcks klockan tre på natten. Skjut fram i halvtimmessteg tills vi är ute
// ur tystnadsfönstret; det spänner över midnatt när from > to.
function utanforTystnad(d: Date, tyst?: { from: number; to: number }): Date {
  if (!tyst) return d;
  let t = new Date(d);
  for (let i = 0; i < 96; i++) {
    const h = stockholmTimme(t);
    const iTyst = tyst.from > tyst.to
      ? (h >= tyst.from || h < tyst.to)
      : (h >= tyst.from && h < tyst.to);
    if (!iTyst) return t;
    t = new Date(t.getTime() + 30 * 60_000);
  }
  return t;
}

function fornamnAv(namn: string): string {
  return (namn ?? "").trim().split(/\s+/)[0] || "hej";
}

function fyllMall(mall: string, namn: string): string {
  return mall.replace(/\{fornamn\}/g, fornamnAv(namn)).replace(/\{namn\}/g, namn);
}

async function koaSms(
  route: Route, leadId: string, telefon: string, namn: string, steg = 1,
) {
  const sms = route.config?.sms;
  if (!sms?.active || !telefon) return;
  const steps = sms.steps ?? [];
  const def = steps[steg - 1];
  if (!def) return;

  const nar = utanforTystnad(
    new Date(Date.now() + (def.delay_min ?? 5) * 60_000),
    sms.quiet,
  );

  const { error } = await supabase.from("lead_sms_outbox").insert({
    tenant_id: route.tenant_id, lead_id: leadId, page_id: route.page_id,
    steg, send_at: nar.toISOString(), to_phone: telefon,
    body: fyllMall(def.text, namn),
  });
  // 23505 = steget finns redan i kön. Det är rätt utfall, inte ett fel.
  if (error && error.code !== "23505") console.error("koaSms", error.message);
}

async function avbrytKo(leadId: string, anledning: string) {
  await supabase.from("lead_sms_outbox")
    .update({ status: "cancelled", error: anledning })
    .eq("lead_id", leadId).eq("status", "pending");
}

// Plockar det som förfallit. Claimar först, skickar sedan: två samtidiga
// knackningar kan aldrig skicka samma rad två gånger.
async function runSmsQueue() {
  const { data: klara } = await supabase.from("lead_sms_outbox")
    .select("id").eq("status", "pending").lte("send_at", new Date().toISOString())
    .order("send_at").limit(25);
  if (!klara?.length) return { skickade: 0, fel: 0 };

  let skickade = 0, fel = 0;
  for (const { id } of klara) {
    const { data: rad } = await supabase.from("lead_sms_outbox")
      .update({ status: "sending" })
      .eq("id", id).eq("status", "pending")
      .select("*").maybeSingle();
    if (!rad) continue;                       // någon annan hann före

    const route = await routeFor(rad.page_id);
    const avsandare = route?.config?.sms?.from ?? "Skyland";
    const r = await sendSms(rad.to_phone, avsandare, rad.body);

    if (r.error) {
      fel++;
      await supabase.from("lead_sms_outbox")
        .update({ status: "failed", error: r.error }).eq("id", id);
      console.error("sms till lead misslyckades", rad.lead_id, r.error);
      continue;
    }

    skickade++;
    await supabase.from("lead_sms_outbox")
      .update({ status: "sent", provider_id: r.id ?? null, sent_at: new Date().toISOString() })
      .eq("id", id);
    await supabase.from("ce_lead_events").insert({
      tenant_id: rad.tenant_id, lead_id: rad.lead_id, event_type: "sms_sent",
      actor: "system", payload: { steg: rad.steg, to: rad.to_phone, id: r.id },
    });

    // Nästa steg köas först när det här gick iväg, så att en kedja aldrig
    // fortsätter efter ett fel eller efter att leadet svarat.
    if (route) {
      const { data: lead } = await supabase.from("ce_leads")
        .select("name").eq("id", rad.lead_id).maybeSingle();
      await koaSms(route, rad.lead_id, rad.to_phone, lead?.name ?? "", rad.steg + 1);
    }
  }
  return { skickade, fel };
}

// 46elks postar inkommande SMS hit (form-encoded). Ett svar betyder att leadet
// är levande: sekvensen stoppas, kortet blir hett, och Joakim får en notis.
async function hanteraInkommandeSms(form: URLSearchParams) {
  const fran = (form.get("from") ?? "").trim();
  const text = (form.get("message") ?? "").trim();
  if (!fran) return { ok: false, fel: "saknar avsändare" };

  const { data: rad } = await supabase.from("lead_sms_outbox")
    .select("lead_id,tenant_id,page_id").eq("to_phone", fran)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!rad) {
    console.log("inkommande sms från okänt nummer", fran);
    return { ok: true, matchat: false };
  }

  await avbrytKo(rad.lead_id, "leadet svarade");

  await supabase.from("ce_leads").update({
    hot_at: new Date().toISOString(),
    hot_reasons: ["sms_svar"],
    updated_at: new Date().toISOString(),
  }).eq("id", rad.lead_id);

  await supabase.from("ce_lead_events").insert({
    tenant_id: rad.tenant_id, lead_id: rad.lead_id, event_type: "sms_reply",
    actor: "lead", payload: { from: fran, message: text },
  });

  const route = await routeFor(rad.page_id);
  const { data: lead } = await supabase.from("ce_leads")
    .select("name,phone").eq("id", rad.lead_id).maybeSingle();
  for (const to of route?.config?.notify?.sms_to ?? []) {
    await sendSms(to, route?.config?.notify?.sms_from ?? "Skyland",
      `SVAR fran ${lead?.name ?? fran}\n${fran}\n"${text.slice(0, 140)}"\nRing nu.`);
  }

  console.log("sms-svar", rad.lead_id, fran);
  return { ok: true, matchat: true };
}

// ---------- backfill ----------

// Ett lead som kom in innan webhooken var kopplad ligger kvar i Metas Leadcenter
// och kommer aldrig av sig själv. Backfillen läser formulärens leadlistor och kör
// dem genom exakt samma väg som webhooken. Den är idempotent på dedupe_key, så
// den kan köras om utan att skapa dubbletter.

const LEAD_FIELDS = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id," +
  "campaign_name,form_id,platform,is_organic,field_data";

async function graphGet(path: string, params: Record<string, string>) {
  const token = env("META_PAGE_TOKEN");
  if (!token) throw new Error("META_PAGE_TOKEN saknas");
  const q = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`${GRAPH}/${path}?${q}`);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Graph ${r.status}: ${JSON.stringify(j.error ?? j)}`);
  return j;
}

async function listForms(pageId: string): Promise<Array<{ id: string; name: string }>> {
  const j = await graphGet(`${pageId}/leadgen_forms`, { fields: "id,name,status", limit: "100" });
  return (j.data ?? [])
    .filter((f: any) => !f.status || f.status === "ACTIVE")
    .map((f: any) => ({ id: String(f.id), name: f.name ?? "" }));
}

async function backfillForm(
  route: Route,
  form: { id: string; name: string },
  o: { since?: number; max: number; notify: boolean; dryRun: boolean },
) {
  const resultat = { form_id: form.id, form_name: form.name, hittade: 0, nya: 0, sammanslagna: 0, fanns: 0, fel: [] as string[] };
  let url: string | null = null;
  let sida = await graphGet(`${form.id}/leads`, { fields: LEAD_FIELDS, limit: "100" });

  while (true) {
    for (const lead of sida.data ?? []) {
      if (resultat.hittade >= o.max) return resultat;
      const t = Date.parse(lead.created_time ?? "") / 1000;
      if (o.since && Number.isFinite(t) && t < o.since) return resultat;  // listan är fallande
      resultat.hittade++;
      if (o.dryRun) continue;
      try {
        const utfall = await upsertLead(route, lead, { notify: o.notify, form_id: form.id });
        if (utfall === "inserted") resultat.nya++;
        else if (utfall === "merged") resultat.sammanslagna++;
        else resultat.fanns++;
      } catch (e) {
        resultat.fel.push(`${lead.id}: ${(e as Error)?.message ?? e}`);
      }
    }
    url = sida.paging?.next ?? null;
    if (!url) return resultat;
    const r = await fetch(url);
    sida = await r.json();
    if (sida.error) { resultat.fel.push(JSON.stringify(sida.error)); return resultat; }
  }
}

async function runBackfill(b: {
  page_id?: string; form_id?: string; since?: string; max?: number;
  notify?: boolean; dry_run?: boolean;
}) {
  const route = await routeFor(b.page_id);
  if (!route) throw new Error(`ingen aktiv route för page_id ${b.page_id}`);

  const since = b.since ? Math.floor(Date.parse(b.since) / 1000) : undefined;
  if (b.since && !Number.isFinite(since)) throw new Error(`ogiltigt since: ${b.since}`);

  const formular = b.form_id
    ? [{ id: String(b.form_id), name: "" }]
    : await listForms(route.page_id);

  const o = {
    since, max: Math.min(b.max ?? 500, 2000),
    notify: b.notify === true,          // tyst som standard: gamla leads ska inte larma
    dryRun: b.dry_run === true,
  };

  const formularResultat = [];
  for (const f of formular) formularResultat.push(await backfillForm(route, f, o));

  return {
    ok: true,
    page_id: route.page_id,
    page_name: route.page_name,
    dry_run: o.dryRun,
    since: b.since ?? null,
    formular: formularResultat,
    summa: formularResultat.reduce((a, r) => ({
      hittade: a.hittade + r.hittade, nya: a.nya + r.nya,
      sammanslagna: a.sammanslagna + r.sammanslagna, fanns: a.fanns + r.fanns,
      fel: a.fel + r.fel.length,
    }), { hittade: 0, nya: 0, sammanslagna: 0, fanns: 0, fel: 0 }),
  };
}

// ---------- HTTP ----------

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    // Metas verifieringshandskakning.
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === env("META_VERIFY_TOKEN") && challenge) {
      return new Response(challenge, { status: 200 });
    }
    // Schemaläggaren (pg_cron varje minut). Ingen nyckel: den skickar bara det
    // som redan ligger i kön och förfallit, och claimar raden innan den skickar.
    if (url.searchParams.get("run_sms") === "1") {
      return Response.json(await runSmsQueue());
    }

    // Vilka avsändarnummer finns hos 46elks? Svaret på om tvåvägs-sms går alls.
    // Läser hemligheten inne i körmiljön och visar bara numren.
    if (url.searchParams.get("sms_diag") === "1") {
      const user = env("ELKS_USER"), pass = env("ELKS_PASS");
      if (!user || !pass) return Response.json({ ok: false, fel: "ELKS-uppgifter saknas" });
      const r = await fetch("https://api.46elks.com/a1/numbers", {
        headers: { Authorization: "Basic " + btoa(`${user}:${pass}`) },
      });
      const j = await r.json().catch(() => ({}));
      return Response.json({ ok: r.ok, nummer: j.data ?? j });
    }

    // Enkel hälsokoll: vilka sidor är inkopplade? Inga leaddata, inga nycklar.
    if (url.searchParams.get("routes") === "1") {
      const { data } = await supabase.from("meta_lead_routes")
        .select("page_id,page_name,active").order("page_name");
      return Response.json({ ok: true, routes: data ?? [] });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // 46elks postar inkommande SMS hit, form-encoded. Ingen Meta-signatur.
  if (url.searchParams.get("inbound_sms") === "1") {
    const form = new URLSearchParams(await req.text());
    try {
      return Response.json(await hanteraInkommandeSms(form));
    } catch (e) {
      console.error("inkommande sms", e);
      return Response.json({ ok: false }, { status: 200 });   // 46elks ska inte retrya
    }
  }

  // Backfill är ett administratörsanrop, inte en Meta-händelse. Den bär ingen
  // Meta-signatur, så den autentiseras med LEAD_INTAKE_ADMIN_KEY (eller tjänste-
  // nyckeln) som Bearer i stället.
  if (url.searchParams.get("backfill") === "1") {
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const nycklar = [env("LEAD_INTAKE_ADMIN_KEY"), env("SUPABASE_SERVICE_ROLE_KEY")].filter(Boolean);
    if (!nycklar.some((n) => timingSafeEqual(bearer, n))) {
      return new Response("unauthorized", { status: 401 });
    }
    let b: any;
    try { b = JSON.parse(await req.text() || "{}"); } catch { return new Response("bad json", { status: 400 }); }
    try {
      return Response.json(await runBackfill(b));
    } catch (e) {
      return Response.json({ ok: false, fel: (e as Error)?.message ?? String(e) }, { status: 400 });
    }
  }

  const body = await req.text();

  // Varje kund får en egen Meta-app i sin egen portfölj, eftersom systemanvändaren
  // som läser leadsen måste finnas där sidan finns. Alla apparna pekar på den här
  // adressen, så vi kan få signaturer från flera appar och måste godta var och en.
  // META_APP_SECRETS är kommaseparerad; META_APP_SECRET finns kvar för en app.
  const secrets = [
    ...env("META_APP_SECRETS").split(",").map((s) => s.trim()).filter(Boolean),
    env("META_APP_SECRET"),
  ].filter(Boolean);

  if (secrets.length) {
    const header = req.headers.get("x-hub-signature-256") ?? "";
    let giltig = false;
    for (const secret of secrets) {
      if (timingSafeEqual(header, "sha256=" + await hmacSha256Hex(secret, body))) { giltig = true; break; }
    }
    if (!giltig) {
      console.error("felaktig signatur");
      return new Response("bad signature", { status: 401 });
    }
  } else {
    console.warn("ingen app-hemlighet satt — signaturen kontrolleras inte");
  }

  let payload: any;
  try { payload = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
  if (payload?.object !== "page") return new Response("ignored", { status: 200 });

  // Svara Meta direkt. Gör vi jobbet först hinner deras timeout gå ut och de
  // skickar om, vilket ser ut som dubbletter tills dedupe fångar dem.
  const jobb: Promise<unknown>[] = [];
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen") continue;
      jobb.push(
        processLeadgen({ ...ch.value, page_id: ch.value?.page_id ?? entry.id })
          .catch((e) => console.error("processLeadgen", ch.value?.leadgen_id, e?.message ?? e)),
      );
    }
  }
  if (jobb.length) EdgeRuntime.waitUntil(Promise.allSettled(jobb));
  return new Response("ok", { status: 200 });
});
