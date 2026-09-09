/**
 * Markören som talar om för Alex att frågan TALADES in.
 *
 * Gateway-chatten har ingen kanal-flagga att skicka med (till skillnad från
 * SCC:s egen /chat/chat, där channel='voice' finns). Så beskedet får åka med
 * i själva meddelandet. Utan det svarar Alex som på skrift — 9 sep förklarade
 * han för Joakim att han "bara använder röst när du skickar ett röstmeddelande",
 * mitt i ett samtal som fördes med röst.
 *
 * Markören är till för agenten, inte för ögat: `stripVoiceMarker` plockar bort
 * den när meddelandet visas, så tråden innehåller det Joakim faktiskt sa.
 */

export const VOICE_MARKER = '[RÖST]';

const INSTRUKTION =
    'Jag pratade in det här och ditt svar läses upp med din röst. ' +
    'Svara talvänligt: korta meningar, ingen markdown, inga listor eller rubriker. ' +
    'Du hör och svarar alltså med röst — säg aldrig motsatsen.';

/** Klär transkriptet så agenten vet att det är tal. */
export function withVoiceMarker(transcript: string): string {
    return `${VOICE_MARKER} ${INSTRUKTION}\n\n${transcript.trim()}`;
}

/** Tar bort markören inför visning. Lämnar allt annat orört. */
export function stripVoiceMarker(content: string): string {
    if (!content.startsWith(VOICE_MARKER)) return content;
    const brytning = content.indexOf('\n\n');
    return brytning === -1 ? content.slice(VOICE_MARKER.length).trim() : content.slice(brytning + 2);
}

/** True när meddelandet talades in — används för mikrofonikonen i tråden. */
export function wasSpoken(content: string): boolean {
    return content.startsWith(VOICE_MARKER);
}
