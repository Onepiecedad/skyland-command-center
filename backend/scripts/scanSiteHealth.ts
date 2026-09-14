/**
 * CLI för sajthälso-skanningen.
 *
 *   npx tsx scripts/scanSiteHealth.ts --dry            # kolla, skriv inget
 *   npx tsx scripts/scanSiteHealth.ts --limit 100      # kolla och spara
 *   npx tsx scripts/scanSiteHealth.ts --recheck 7      # kontrollera om äldre än 7 dygn
 *
 * Kör detta från Macen, inte från Render. Datacenter-IP blockeras av WAF och
 * friska sajter går då inte att bedöma (de blir INCONCLUSIVE, aldrig lead).
 */

import 'dotenv/config';
import { scanContactSites } from '../src/services/siteHealthScan';

function flag(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
    const dryRun = process.argv.includes('--dry');
    const limit = Number(flag('limit') ?? 400);
    const recheckAfterDays = Number(flag('recheck') ?? 30);

    console.log(`Skannar upp till ${limit} kontakter` +
        `${dryRun ? ' (dryRun — inget sparas)' : ''}, omkontroll efter ${recheckAfterDays} dygn.\n`);

    const s = await scanContactSites({ limit, recheckAfterDays, dryRun });

    console.log('=== SAMMANFATTNING ===');
    console.log(`kontrollerade ${s.scanned} | hoppade över ${s.skipped} | ` +
        `säljbara ${s.sellable} | osäkra ${s.inconclusive} | ok ${s.ok} | skrivfel ${s.write_errors}`);
    console.log('per verdikt:', JSON.stringify(s.by_verdict));

    if (s.scanned > 0 && s.inconclusive / s.scanned > 0.2) {
        console.log('\n⚠  Mer än 20 % blev INCONCLUSIVE. Nätet blockeras troligen av WAF.');
        console.log('   Kör om från Macens eget nät innan du litar på siffran.');
    }

    if (s.leads.length) {
        console.log('\n=== TRÄFFAR ===');
        for (const l of s.leads) {
            console.log(`  ${l.verdict.padEnd(14)} ${l.domain.padEnd(32)} ` +
                `${l.company ?? ''}\n${' '.repeat(18)}${l.evidence}`);
        }
    } else {
        console.log('\nInga säljbara träffar.');
    }
}

main().catch(err => { console.error(err); process.exit(1); });
