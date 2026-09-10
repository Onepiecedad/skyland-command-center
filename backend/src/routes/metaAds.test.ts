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
