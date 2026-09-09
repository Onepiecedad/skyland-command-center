/**
 * useWalkieTalkie — håll-och-prata mot samma Alex som textchatten.
 *
 * Kedjan: MediaRecorder → POST /voice/stt (ElevenLabs Scribe) → transkriptet
 * skickas in i exakt samma chattkedja som textfältet (onTranscript) → svaret
 * läses upp via POST /voice/alex-tts (Alex svenska röst). Inget eget agent-
 * läge, inga egna rättigheter: rösten är bara ett annat tangentbord.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, fetchWithAuth } from '../api';

export type TalkState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

export const TALK_LABEL: Record<TalkState, string> = {
    idle: '',
    recording: 'Lyssnar… släpp för att skicka',
    transcribing: 'Skriver ner…',
    thinking: 'Alex tänker…',
    speaking: 'Alex pratar…',
};

const MIN_RECORD_MS = 350;
const TTS_MAX_CHARS = 1100; // backend klipper vid 1200

interface Options {
    /** Skickar transkriptet in i chatten och returnerar Alex svar (eller null vid fel). */
    onTranscript: (text: string) => Promise<string | null>;
}

function pickMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

/** Markdown → något som går att läsa upp. Klipper vid meningsslut nära taket. */
export function toSpeech(md: string): string {
    let t = md
        // Kvittot ("--- Faktiskt utfört: …") är för ögat, aldrig för örat.
        .replace(/\n\s*---\s*\n[\s\S]*$/, '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/^\s*\|?[\s:-]+\|[\s|:-]*$/gm, '')
        .replace(/\|/g, ', ')
        .replace(/[*_~>#]/g, '')
        .replace(/\s*\n\s*\n\s*/g, '. ')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (t.length > TTS_MAX_CHARS) {
        const cut = t.slice(0, TTS_MAX_CHARS);
        const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
        t = end > TTS_MAX_CHARS * 0.5 ? cut.slice(0, end + 1) : cut;
    }
    return t;
}

export function useWalkieTalkie({ onTranscript }: Options) {
    const [state, setState] = useState<TalkState>('idle');
    const [error, setError] = useState<string | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const stateRef = useRef<TalkState>('idle');
    const onTranscriptRef = useRef(onTranscript);
    onTranscriptRef.current = onTranscript;

    const supported =
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== 'undefined';

    const go = useCallback((s: TalkState) => {
        stateRef.current = s;
        setState(s);
    }, []);

    const stopPlayback = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
            audioRef.current = null;
        }
    }, []);

    const speak = useCallback(
        async (text: string) => {
            const body = toSpeech(text);
            if (!body) return;
            const res = await fetchWithAuth(`${API_BASE}/voice/alex-tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: body }),
            });
            if (!res.ok) throw new Error(`TTS ${res.status}`);
            const url = URL.createObjectURL(await res.blob());
            await new Promise<void>((resolve) => {
                const a = new Audio(url);
                audioRef.current = a;
                const done = () => {
                    URL.revokeObjectURL(url);
                    if (audioRef.current === a) audioRef.current = null;
                    resolve();
                };
                a.onended = done;
                a.onerror = done;
                a.onemptied = done; // hush() nollar src → lös upp löftet
                a.play().catch(done);
            });
        },
        [],
    );

    const handleBlob = useCallback(
        async (blob: Blob) => {
            try {
                go('transcribing');
                const stt = await fetchWithAuth(`${API_BASE}/voice/stt`, {
                    method: 'POST',
                    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
                    body: blob,
                });
                if (!stt.ok) throw new Error(`STT ${stt.status}`);
                const { text } = (await stt.json()) as { text?: string };
                const transcript = (text ?? '').trim();
                if (!transcript) {
                    setError('Hörde inget. Håll in knappen och prata.');
                    go('idle');
                    return;
                }
                go('thinking');
                const reply = await onTranscriptRef.current(transcript);
                if (!reply) {
                    go('idle');
                    return;
                }
                go('speaking');
                await speak(reply);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Röstfel');
            } finally {
                go('idle');
            }
        },
        [go, speak],
    );

    const start = useCallback(async () => {
        if (!supported || stateRef.current !== 'idle') return;
        setError(null);
        stopPlayback();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = pickMimeType();
            const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            chunksRef.current = [];
            rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            rec.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                const tooShort = Date.now() - startedAtRef.current < MIN_RECORD_MS;
                const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType || 'audio/webm' });
                recorderRef.current = null;
                if (tooShort || blob.size < 1000) {
                    go('idle');
                    return;
                }
                void handleBlob(blob);
            };
            recorderRef.current = rec;
            startedAtRef.current = Date.now();
            rec.start();
            go('recording');
        } catch (e) {
            setError(e instanceof Error && e.name === 'NotAllowedError'
                ? 'Mikrofonen är blockerad i webbläsaren.'
                : 'Kunde inte starta mikrofonen.');
            go('idle');
        }
    }, [supported, stopPlayback, go, handleBlob]);

    const stop = useCallback(() => {
        const rec = recorderRef.current;
        if (rec && rec.state !== 'inactive') rec.stop();
    }, []);

    /** Avbryt uppspelning (t.ex. när man trycker för att prata igen). */
    const hush = useCallback(() => {
        stopPlayback();
        if (stateRef.current === 'speaking') go('idle');
    }, [stopPlayback, go]);

    useEffect(() => () => {
        stopPlayback();
        const rec = recorderRef.current;
        if (rec && rec.state !== 'inactive') {
            rec.onstop = null;
            rec.stop();
            rec.stream.getTracks().forEach((t) => t.stop());
        }
    }, [stopPlayback]);

    return { state, error, supported, start, stop, hush, clearError: () => setError(null) };
}
