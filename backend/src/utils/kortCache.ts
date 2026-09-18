/**
 * Kort minnescache för läsningar som pollas hårdare än de ändrar sig.
 *
 * Bakgrunden: kontorsvyn hämtade batchkortet var femte sekund och varje träff
 * kostade två Supabase-frågor. Mätt 17 sep blev det omkring 1 600 anrop i
 * timmen så länge fliken stod öppen — systemets största egresspost, för en
 * dagssiffra som ändrar sig någon gång i timmen. Frontenden pollar nu
 * långsammare, men en cache här gör rutten billig oavsett vem som pollar den
 * och hur ofta.
 *
 * Två egenskaper som spelar roll:
 *   1. Träff inom `ms` returnerar sparat värde utan att röra databasen.
 *   2. Samtidiga anrop delar EN pågående hämtning, så tio öppna flikar ger en
 *      fråga i stället för tio.
 *
 * Ett fel cachas aldrig — nästa anrop försöker igen.
 */
export function kortCache<T>(ms: number, hamta: () => Promise<T>): () => Promise<T> {
    let sparat: { at: number; value: T } | null = null;
    let pagaende: Promise<T> | null = null;

    return () => {
        if (sparat && Date.now() - sparat.at < ms) return Promise.resolve(sparat.value);
        if (pagaende) return pagaende;
        pagaende = hamta()
            .then((value) => { sparat = { at: Date.now(), value }; return value; })
            .finally(() => { pagaende = null; });
        return pagaende;
    };
}
