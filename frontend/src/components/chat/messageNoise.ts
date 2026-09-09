/**
 * Vad som INTE hör hemma i Alex-vyn.
 *
 * Vyn visar gateway-sessionens råa historik, och där ligger mer än samtalet:
 * OpenClaws egna systeminjektioner efter en omstart, agentens minnesfiler som
 * lästs in i tråden, och verktygsresultat i JSON. Allt det är begripligt för
 * en maskin och obegripligt för en människa som bara vill se vad hon och Alex
 * sagt. Filtret döljer det — det raderas aldrig, det ligger kvar i sessionen.
 *
 * Regeln för att lägga till ett mönster här: det ska vara något som ALDRIG är
 * ett samtal. Hellre släppa igenom en konstig rad än dölja något Alex faktiskt
 * sagt till Joakim.
 */

export interface NoiseCandidate {
    role: string;
    content: string;
}

/** Injektioner från OpenClaw självt, inte från Joakim och inte från Alex. */
const SYSTEM_INJECTION = [
    /^\[System\]/i,
    /^\[Systemmeddelande\]/i,
    /previous turn was interrupted/i,
    /^Note: The interrupted final reply was captured:/i,
];

/** Agentens minnes- och buffertfiler, inlästa i tråden vid start eller compaction. */
const MEMORY_SCAFFOLDING = [
    /^Working Buffer/i,
    /^Status:\s*(INACTIVE|ACTIVE)\b[\s\S]*Started:/i,
    /^No today's memory file/i,
    /^#+\s*MEMORY\.md/i,
    /^<!--[\s\S]*-->$/,
];

/** Rena maskinsvar: verktygsresultat och pekare i JSON. */
function isMachinePayload(c: string): boolean {
    if ((c.startsWith('{') && c.endsWith('}')) || (c.startsWith('[') && c.endsWith(']'))) {
        try {
            JSON.parse(c);
            return true;
        } catch {
            return false;
        }
    }
    return false;
}

/** True = dölj raden i Alex-vyn. */
export function isNoiseMessage(msg: NoiseCandidate): boolean {
    const c = (msg.content ?? '').trim();
    if (!c) return true;
    if (msg.role === 'system') return true;
    if (SYSTEM_INJECTION.some(re => re.test(c))) return true;
    if (MEMORY_SCAFFOLDING.some(re => re.test(c))) return true;
    if (isMachinePayload(c)) return true;
    return false;
}
