import { describe, it, expect } from 'vitest';

/**
 * Avstämningen är hela poängen med vyn, så den räknas här — inte bara i UI:t.
 * `tapp` = vad Meta räknade minus vad som faktiskt ligger i CRM:t.
 */
function tapp(metaLeads: number, crmLeads: number): number {
    return metaLeads - crmLeads;
}

function kostnadPerLead(spend: number, leads: number): number | null {
    return leads > 0 ? Math.round((spend / leads) * 100) / 100 : null;
}

describe('meta-ads: avstämning mot CRM', () => {
    it('noll tapp när allt kommit fram', () => {
        expect(tapp(63, 63)).toBe(0);
    });

    it('positivt tapp när leads inte nått CRM:t', () => {
        expect(tapp(63, 58)).toBe(5);
    });

    it('negativt tapp när CRM:t har leads från andra källor', () => {
        expect(tapp(63, 70)).toBe(-7);
    });
});

describe('meta-ads: kostnad per lead', () => {
    it('räknar ut och avrundar till ören', () => {
        expect(kostnadPerLead(889.74, 63)).toBe(14.12);
    });

    it('är null vid noll leads i stället för Infinity', () => {
        expect(kostnadPerLead(500, 0)).toBeNull();
    });

    it('är null även när både spend och leads är noll', () => {
        expect(kostnadPerLead(0, 0)).toBeNull();
    });
});

/**
 * Regression, 10 sep: forsta versionen raknade alltid i ce_leads utan
 * kundfilter. Nasta kund hade da fatt Cold Experiences leads jamforda mot sin
 * egen spend — en pahittad siffra som ser ut som ett larm. Utan konfigurerad
 * mottagare ska avstamningen vara null, inte noll.
 */
function avstamning(metaLeads: number, crmLeads: number | null): number | null {
    return crmLeads === null ? null : metaLeads - crmLeads;
}

describe('meta-ads: kunder utan lead-mottagare', () => {
    it('ger null i stället för noll när avstämning saknas', () => {
        expect(avstamning(63, null)).toBeNull();
    });

    it('noll betyder fortfarande "allt kom fram", inte "ingen data"', () => {
        expect(avstamning(63, 63)).toBe(0);
    });
});
