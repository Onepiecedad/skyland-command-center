/**
 * siteHealth — klassificerar en domäns webbnärvaro.
 *
 * Byggd efter ett skarpt test mot 162 domäner ur prospects/contacts (14 sep 2026).
 * Ett naivt test gav ~40 % falska positiva. Reglerna nedan är de som tog bort dem.
 *
 * VIKTIGT: kör detta från ett nät med vanligt rykte. Från ett datacenter-IP
 * svarar många sajter 403 och du flaggar friska kunder som trasiga.
 */

export type Verdict =
  | 'OK'              // sajten fungerar
  | 'DOMAIN_GONE'     // DNS svarar inte — domänen har löpt ut
  | 'SERVER_DEAD'     // domänen finns, ingen server svarar
  | 'ORIGIN_DOWN'     // proxy (Cloudflare) svarar 52x, origin nere
  | 'SERVER_ERROR'    // 5xx på startsidan
  | 'CERT_BROKEN'     // certfel på BÅDA värdnamnen — besökare får säkerhetsvarning
  | 'HIJACKED'        // redirectar bort till en främmande domän
  | 'MOVED'           // redirectar till eget nytt domännamn — byt URL i CRM, inget lead
  | 'PARKED'          // landar hos domänhandlare eller hostingplatshållare
  | 'EMPTY'           // svarar 200 men utan <title>/innehåll — parkerad
  | 'INCONCLUSIVE';   // botblockering eller challenge — vi vet inte, flagga inte

export interface SiteHealth {
  domain: string;
  verdict: Verdict;
  sellable: boolean;      // duger detta som utgångspunkt för outreach?
  evidence: string;
  finalUrl?: string;
}

import * as https from 'node:https';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const TIMEOUT_MS = 20_000;

interface Probe {
  ok: boolean;
  status?: number;
  body?: string;
  finalUrl?: string;
  errCode?: string;
}

/**
 * Titt bakom ett trasigt cert. Egen https.Agent i stället för
 * process.env.NODE_TLS_REJECT_UNAUTHORIZED — den flaggan är global och hade
 * slagit av certkontrollen för alla samtidiga anrop, inte bara det här.
 */
function probeIgnoringCert(host: string): Promise<Probe> {
  return new Promise(resolve => {
    const req = https.get(
      { host, path: '/', timeout: TIMEOUT_MS,
        agent: new https.Agent({ rejectUnauthorized: false }),
        headers: { 'User-Agent': UA } },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { if (body.length < 200_000) body += c; });
        res.on('end', () => resolve({ ok: true, status: res.statusCode, body }));
      });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, errCode: 'ETIMEDOUT' }); });
    req.on('error', (e: any) => resolve({ ok: false, errCode: String(e?.code ?? 'UNKNOWN') }));
  });
}

async function probe(host: string, insecure = false): Promise<Probe> {
  if (insecure) return probeIgnoringCert(host);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://${host}`, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'sv-SE,sv;q=0.9' },
    });
    const body = await res.text().catch(() => '');
    return { ok: true, status: res.status, body, finalUrl: res.url };
  } catch (e: any) {
    const raw = e?.cause?.code ?? e?.code ?? e?.name ?? 'UNKNOWN';
    // Bara begripliga felkoder får gå vidare — en naken siffra säger inget.
    const code = typeof raw === 'string' && /^[A-Z_]{3,}$/.test(raw) ? raw : 'CONNECT_FAILED';
    return { ok: false, errCode: code };
  } finally {
    clearTimeout(timer);
  }
}

const CERT_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
]);
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

/** Cloudflare-challenge och WAF-blockeringar. Vi VET inte — flagga aldrig. */
function isBotWall(p: Probe): boolean {
  if (p.status === 403) return true;
  const b = (p.body ?? '').slice(0, 1500).toLowerCase();
  return b.includes('just a moment') || b.includes('cf-browser-verification')
      || b.includes('attention required') || b.includes('enable javascript and cookies');
}

function hasRealContent(p: Probe): boolean {
  const b = p.body ?? '';
  // Titel är ett bättre mått än storlek: en SPA kan vara 2 KB och helt frisk.
  return /<title[^>]*>\s*\S[^<]{2,}<\/title>/i.test(b);
}

/** Värdar som betyder "ingen sajt här": domänhandlare och hostingplatshållare. */
const PARKING_HOSTS = [
  'expireddomains.', 'sedoparking.', 'parkingcrew.', 'afternic.', 'dan.com',
  'sg-host.com', 'hostinger', 'bodis.com', 'above.com', 'undeveloped.com',
];

/** Namnstammen utan TLD och skiljetecken: "brandon-lodge.se" -> "brandonlodge". */
function stem(host: string): string {
  return host.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
}

/**
 * Samma företag under nytt namn, eller någon annans domän?
 * egoe.se -> egoestetica.se är ett namnbyte. helhud.se -> thefranciscoguide.com
 * är det inte. Sex tecken är gränsen som skilde dem åt i den skarpa körningen.
 */
function looksLikeRebrand(from: string, to: string): boolean {
  const a = stem(from), b = stem(to);
  if (!a || !b) return false;
  return a.includes(b.slice(0, 6)) || b.includes(a.slice(0, 6));
}

function registrable(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

export async function checkSite(domain: string): Promise<SiteHealth> {
  const d = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  const hosts = [d, `www.${d}`];
  const probes = await Promise.all(hosts.map(h => probe(h)));

  const out = (verdict: Verdict, sellable: boolean, evidence: string, finalUrl?: string): SiteHealth =>
    ({ domain: d, verdict, sellable, evidence, finalUrl });

  // 1. Frisk? Räcker att EN variant fungerar — apex som 301:ar till www är normalt.
  for (const p of probes) {
    if (p.ok && p.status === 200 && hasRealContent(p)) {
      const from = registrable(`https://${d}`), to = registrable(p.finalUrl ?? '');
      if (to && to !== from) {
        if (PARKING_HOSTS.some(ph => to.includes(ph))) {
          return out('PARKED', true,
            `Redirectar till ${to} — domänen ligger hos en domänhandlare/platshållare`, p.finalUrl);
        }
        if (looksLikeRebrand(from, to)) {
          return out('MOVED', false,
            `Redirectar till ${to} — samma företag under nytt namn, uppdatera URL:en`, p.finalUrl);
        }
        return out('HIJACKED', true,
          `Redirectar till ${to} — domänen pekar inte längre på företaget`, p.finalUrl);
      }
      return out('OK', false, `HTTP 200 med innehåll`, p.finalUrl);
    }
  }

  // 2. Botvägg på någon variant => vi vet ingenting. Aldrig ett lead.
  if (probes.some(p => p.ok && isBotWall(p))) {
    return out('INCONCLUSIVE', false, 'Blockerad av WAF/challenge — kör om från annat nät');
  }

  // 3. DNS borta på båda
  if (probes.every(p => !p.ok && DNS_CODES.has(p.errCode!))) {
    return out('DOMAIN_GONE', true, 'DNS svarar inte — domänen har troligen löpt ut');
  }

  // 4. Certfel på båda: finns det något bakom certet?
  if (probes.every(p => !p.ok && CERT_CODES.has(p.errCode!))) {
    const behind = await probe(d, true);
    const detail = probes[0].errCode;
    return out('CERT_BROKEN', true,
      behind.ok && hasRealContent(behind)
        ? `Säkerhetsvarning för alla besökare (${detail}); sajten finns bakom certet`
        : `Säkerhetsvarning (${detail}) och inget innehåll bakom`);
  }

  // 5. Cloudflare 52x / serverfel
  const statuses = probes.filter(p => p.ok).map(p => p.status!);
  if (statuses.length && statuses.every(s => s >= 520 && s <= 527)) {
    return out('ORIGIN_DOWN', true, `Cloudflare ${statuses[0]} — origin svarar inte`);
  }
  if (statuses.length && statuses.every(s => s >= 500)) {
    return out('SERVER_ERROR', true, `HTTP ${statuses[0]} på startsidan`);
  }

  // 6. 200 men tomt
  if (probes.some(p => p.ok && p.status === 200)) {
    return out('EMPTY', true, 'Svarar 200 men saknar titel/innehåll — parkerad domän');
  }

  const codes = [...new Set(probes.map(p => p.errCode).filter(Boolean))];
  return out('SERVER_DEAD', true, `Ingen server svarar (${codes.join(', ')})`);
}

/** Kör många domäner med tak på samtidighet. */
export async function checkSites(domains: string[], concurrency = 12): Promise<SiteHealth[]> {
  const results: SiteHealth[] = [];
  const queue = [...domains];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        results.push(await checkSite(next).catch(
          (e): SiteHealth => ({
            domain: next!, verdict: 'INCONCLUSIVE', sellable: false,
            evidence: `Kontrollen kraschade: ${e?.message ?? e}`,
          })));
      }
    }));
  return results;
}
