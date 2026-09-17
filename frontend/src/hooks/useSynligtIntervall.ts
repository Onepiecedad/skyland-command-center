import { useEffect, useRef } from 'react';

/** Ett intervall som bara tickar när fliken faktiskt syns.
 *
 *  Bakgrunden: panelerna pollade dygnet runt, också klockan tre på natten med
 *  locket nerfällt. Mätt i Supabase-loggen 17 sep låg golvet på omkring 700
 *  anrop i timmen mellan midnatt och gryning, när ingen tittade. Det var i
 *  praktiken hela egresskvoten på gratisplanen, som i den takten hade tagit
 *  slut den 26 september och tystat Nora mitt i säsongen.
 *
 *  Två regler:
 *    1. Aldrig ett tick när document.hidden är sant.
 *    2. En hämtning direkt när fliken blir synlig igen, annars står gammal
 *       data kvar på skärmen ända till nästa tick.
 *
 *  Regel 2 gör att den här är billigare OCH färskare än ett vanligt intervall:
 *  du ser aktuell data i samma ögonblick du tittar, i stället för upp till en
 *  minut gammal. */
export function useSynligtIntervall(fn: () => void, ms: number, aktiv = true) {
    const sparad = useRef(fn);
    sparad.current = fn;

    useEffect(() => {
        if (!aktiv || ms <= 0) return;
        let timer: ReturnType<typeof setInterval> | null = null;

        const stoppa = () => { if (timer) { clearInterval(timer); timer = null; } };
        const starta = () => { if (!timer) timer = setInterval(() => sparad.current(), ms); };

        const vidSynlighet = () => {
            if (document.hidden) { stoppa(); return; }
            sparad.current();
            starta();
        };

        if (!document.hidden) starta();
        document.addEventListener('visibilitychange', vidSynlighet);
        return () => {
            stoppa();
            document.removeEventListener('visibilitychange', vidSynlighet);
        };
    }, [ms, aktiv]);
}
