/**
 * speechQueue — läser upp text medan den fortfarande skrivs.
 *
 * Alex svar strömmar in bit för bit. Att vänta på sista tecknet innan rösten
 * startar kostade fem till tjugo sekunders tystnad per fråga. Kön tar emot
 * texten löpande, klipper ut färdiga meningar och läser upp dem i ordning
 * medan nästa mening redan hämtas — så börjar rösten efter ungefär en sekund
 * och fortsätter utan hål.
 */

import { API_BASE, fetchWithAuth } from '../api';
import { toSpeech } from '../hooks/useWalkieTalkie';

/** Meningsslut följt av mellanslag/radbrytning, eller radslut. Förkortningar som "t.ex." delar inte. */
const SENTENCE_END = /([.!?…]["')\]]?)(\s+)/;
const ABBREV = /(?:^|\s)(t\.ex|bl\.a|dvs|osv|m\.m|ca|kl|nr|ev|resp|s\.k)\.$/i;
/** Under så här många tecken väntar vi på mer text i stället för att läsa upp en stump. */
const MIN_CHUNK = 24;

type Chunk = { text: string; url?: string; failed?: boolean };

/**
 * Plockar ut de meningar som är färdiga ur en växande buffert.
 * Returnerar meningarna och det som är kvar att vänta på. Ren funktion —
 * hela klippregeln testas här, utan ljud och nät.
 */
export function splitReady(buffer: string): { ready: string[]; rest: string } {
    const ready: string[] = [];
    let rest = buffer;
    for (;;) {
        const m = SENTENCE_END.exec(rest);
        if (!m) break;
        const cut = m.index + m[1].length;
        const candidate = rest.slice(0, cut);
        if (ABBREV.test(candidate) || candidate.trim().length < MIN_CHUNK) {
            const next = SENTENCE_END.exec(rest.slice(cut));
            if (!next) break;
            const longer = rest.slice(0, cut + next.index + next[1].length);
            ready.push(longer.trim());
            rest = rest.slice(longer.length).replace(/^\s+/, '');
            continue;
        }
        ready.push(candidate.trim());
        rest = rest.slice(cut + m[2].length);
    }
    return { ready, rest };
}

class SpeechQueue {
    private buffer = '';
    private chunks: Chunk[] = [];
    private playing = false;
    private audio: HTMLAudioElement | null = null;
    private run = 0;
    private onStateChange: ((speaking: boolean) => void) | null = null;

    onState(fn: ((speaking: boolean) => void) | null) { this.onStateChange = fn; }

    get speaking(): boolean { return this.playing; }

    /** Ny uppläsning: allt tidigare kastas. */
    start() {
        this.stop();
        this.run++;
        this.buffer = '';
        this.chunks = [];
    }

    /** Mata in text allteftersom den kommer. Färdiga meningar köas direkt. */
    push(text: string) {
        this.buffer += text;
        const { ready, rest } = splitReady(this.buffer);
        this.buffer = rest;
        for (const sentence of ready) this.enqueue(sentence);
    }

    /** Sista texten är skriven: läs upp det som är kvar i bufferten. */
    flush() {
        if (this.buffer.trim()) this.enqueue(this.buffer);
        this.buffer = '';
    }

    /** Släng allt som inte hunnit läsas och tysta det som låter. */
    stop() {
        this.run++;
        this.buffer = '';
        this.chunks = [];
        if (this.audio) {
            this.audio.pause();
            this.audio.src = '';
            this.audio = null;
        }
        if (this.playing) {
            this.playing = false;
            this.onStateChange?.(false);
        }
    }

    private enqueue(raw: string) {
        const text = toSpeech(raw);
        if (!text) return;
        const chunk: Chunk = { text };
        this.chunks.push(chunk);
        // Hämta ljudet direkt — nästa mening laddas medan den förra spelas.
        const run = this.run;
        void this.fetchAudio(chunk, run);
        if (!this.playing) void this.drain(run);
    }

    private async fetchAudio(chunk: Chunk, run: number) {
        try {
            const res = await fetchWithAuth(`${API_BASE}/voice/alex-tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: chunk.text }),
            });
            if (!res.ok) throw new Error(`TTS ${res.status}`);
            const url = URL.createObjectURL(await res.blob());
            if (run !== this.run) { URL.revokeObjectURL(url); return; }
            chunk.url = url;
        } catch {
            chunk.failed = true;
        }
    }

    private async drain(run: number) {
        this.playing = true;
        this.onStateChange?.(true);
        while (run === this.run) {
            const chunk = this.chunks[0];
            if (!chunk) break;
            // Vänta på ljudet för den här meningen (max 15 s), annars hoppa över den.
            const started = Date.now();
            while (!chunk.url && !chunk.failed && Date.now() - started < 15_000 && run === this.run) {
                await new Promise((r) => setTimeout(r, 80));
            }
            if (run !== this.run) break;
            this.chunks.shift();
            if (!chunk.url) continue;
            const url = chunk.url;
            await new Promise<void>((resolve) => {
                const a = new Audio(url);
                this.audio = a;
                const done = () => { URL.revokeObjectURL(url); if (this.audio === a) this.audio = null; resolve(); };
                a.onended = done;
                a.onerror = done;
                a.onemptied = done;
                a.play().catch(done);
            });
        }
        if (run === this.run) {
            this.playing = false;
            this.onStateChange?.(false);
        }
    }
}

export const speechQueue = new SpeechQueue();
