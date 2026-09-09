/**
 * Presenter — spelar upp Alex egen guidade genomgång (present_screens).
 *
 * Backend skickar EN ui_action { action: 'present', steps } där varje steg är
 * ett upplöst skärmmål (samma fält som navigate) plus `say`. Här: byt skärm,
 * läs upp texten med Alex röst, gå vidare. Paus/nästa/stopp styrs av docken.
 * Det som sägs kommer från Alex i samma vända, så tal och skärm kan inte
 * glida isär som den gamla skriptade rundturen gjorde.
 */

import { API_BASE, fetchWithAuth } from '../api';
import { applyUiNavigate, type UiNavigateData } from '../navigation/uiActions';

export interface PresentStep extends UiNavigateData {
    say: string;
}

export interface PresenterState {
    steps: PresentStep[];
    index: number;
    status: 'playing' | 'paused' | 'done';
}

type Listener = (s: PresenterState | null) => void;

const STEP_GAP_MS = 700;

async function fetchSpeech(text: string): Promise<string> {
    const res = await fetchWithAuth(`${API_BASE}/voice/alex-tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 1100) }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    return URL.createObjectURL(await res.blob());
}

class Presenter {
    private state: PresenterState | null = null;
    private listeners = new Set<Listener>();
    private audio: HTMLAudioElement | null = null;
    private run = 0; // ökas vid stopp/hopp så en gammal loop avbryter sig själv

    subscribe(fn: Listener): () => void {
        this.listeners.add(fn);
        fn(this.state);
        return () => { this.listeners.delete(fn); };
    }

    private emit() {
        for (const fn of this.listeners) fn(this.state ? { ...this.state } : null);
    }

    get current(): PresenterState | null { return this.state; }

    start(steps: PresentStep[]) {
        if (steps.length === 0) return;
        this.stopAudio();
        this.state = { steps, index: 0, status: 'playing' };
        this.emit();
        void this.loop(++this.run);
    }

    pause() {
        if (!this.state || this.state.status !== 'playing') return;
        this.state.status = 'paused';
        this.audio?.pause();
        this.emit();
    }

    resume() {
        if (!this.state || this.state.status !== 'paused') return;
        this.state.status = 'playing';
        this.emit();
        if (this.audio) { void this.audio.play().catch(() => undefined); }
        else void this.loop(++this.run);
    }

    next() { this.jump(1); }
    prev() { this.jump(-1); }

    private jump(delta: number) {
        if (!this.state) return;
        const i = Math.min(Math.max(this.state.index + delta, 0), this.state.steps.length - 1);
        if (i === this.state.index && delta > 0) { this.stop(); return; }
        this.stopAudio();
        this.state.index = i;
        this.state.status = 'playing';
        this.emit();
        void this.loop(++this.run);
    }

    stop() {
        this.stopAudio();
        this.run++;
        this.state = null;
        this.emit();
    }

    private stopAudio() {
        if (this.audio) {
            this.audio.pause();
            this.audio.src = '';
            this.audio = null;
        }
    }

    private async loop(run: number) {
        while (this.state && run === this.run) {
            const st = this.state;
            if (st.status === 'paused') return;
            const step = st.steps[st.index];
            applyUiNavigate(step);
            try {
                const url = await fetchSpeech(step.say);
                if (run !== this.run) { URL.revokeObjectURL(url); return; }
                await new Promise<void>((resolve) => {
                    const a = new Audio(url);
                    this.audio = a;
                    const done = () => { URL.revokeObjectURL(url); if (this.audio === a) this.audio = null; resolve(); };
                    a.onended = done;
                    a.onerror = done;
                    a.onemptied = done;
                    a.play().catch(done);
                });
            } catch {
                // Utan röst: låt texten stå kvar en stund så den hinner läsas.
                await new Promise((r) => setTimeout(r, Math.min(9000, 1500 + step.say.length * 45)));
            }
            if (run !== this.run || !this.state) return;
            if ((this.state as PresenterState).status === 'paused') return;
            if (this.state.index >= this.state.steps.length - 1) {
                this.state.status = 'done';
                this.emit();
                await new Promise((r) => setTimeout(r, 1500));
                if (run === this.run) { this.state = null; this.emit(); }
                return;
            }
            await new Promise((r) => setTimeout(r, STEP_GAP_MS));
            if (run !== this.run || !this.state || (this.state as PresenterState).status === 'paused') return;
            this.state.index += 1;
            this.emit();
        }
    }
}

export const presenter = new Presenter();
