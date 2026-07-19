/**
 * UpdateWatcher — versionsvakt mot "gammal bundle i fliken"-klassen av fel.
 *
 * Vite hashar bundlenamnet per build. Vakten hämtar index.html (cache: no-store)
 * var femte minut + när fliken får fokus, och jämför serverns bundlenamn med
 * det som faktiskt kör i fliken. Skiljer de sig visas en diskret chip:
 * "Ny version · Ladda om". Inget mer tyst drift på gammal kod.
 */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

function currentBundle(): string | null {
    const src = document.querySelector<HTMLScriptElement>('script[src*="index-"]')?.src;
    return src ? src.split('/').pop() ?? null : null;
}

async function serverBundle(): Promise<string | null> {
    try {
        const html = await fetch('/', { cache: 'no-store' }).then(r => r.text());
        return html.match(/index-[^"]+\.js/)?.[0] ?? null;
    } catch {
        return null; // nätfel ska aldrig störa appen
    }
}

export function UpdateWatcher() {
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        const mine = currentBundle();
        if (!mine) return;

        let cancelled = false;
        const check = async () => {
            const theirs = await serverBundle();
            if (!cancelled && theirs && theirs !== mine) setUpdateAvailable(true);
        };

        const interval = setInterval(check, 5 * 60_000);
        const onFocus = () => { if (document.visibilityState === 'visible') void check(); };
        document.addEventListener('visibilitychange', onFocus);
        window.addEventListener('focus', onFocus);
        void check();

        return () => {
            cancelled = true;
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onFocus);
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    if (!updateAvailable) return null;

    return (
        <button
            className="update-watcher-chip"
            onClick={() => window.location.reload()}
            title="En ny version av dashboarden är deployad — klicka för att ladda om"
            style={{
                position: 'fixed', top: 'calc(10px + env(safe-area-inset-top))', left: '50%',
                transform: 'translateX(-50%)', zIndex: 900,
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '7px 14px', borderRadius: 20, cursor: 'pointer',
                border: '1px solid rgba(16,185,129,0.45)',
                background: 'rgba(6, 24, 16, 0.92)',
                backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                color: '#34d399', fontSize: 12.5, fontWeight: 600,
                boxShadow: '0 4px 20px rgba(0,0,0,0.4), 0 0 14px rgba(16,185,129,0.15)',
            }}
        >
            <RefreshCw size={13} />
            Ny version · Ladda om
        </button>
    );
}
