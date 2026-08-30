/**
 * PostgREST-hjälpare (upptäckt 30 aug 2026): i ett `.or(...)`-filter är komma
 * avgränsare mellan villkor och parenteser grupperare. En söksträng som klistras
 * in rå — "Clinic Vasaplatsen - Vaxning, Laser, Brasiliansk, Ansiktsbehandling" —
 * spränger syntaxen och ger HTTP 500. Kort med kommatecken i namnet gick därför
 * aldrig att söka fram (dm_pipeline föll på exakt detta).
 *
 * Lösningen är PostgREST:s citerade form: ilike."%...%" tillåter komma och
 * parenteser i värdet; citattecken och backslash escapas.
 */
export function pgrstQuote(value: string): string {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** or-uttryck: fältA.ilike."%term%",fältB.ilike."%term%" … säkert för godtycklig term. */
export function ilikeOr(fields: string[], term: string): string {
    const quoted = pgrstQuote(`%${term}%`);
    return fields.map(f => `${f}.ilike.${quoted}`).join(',');
}
