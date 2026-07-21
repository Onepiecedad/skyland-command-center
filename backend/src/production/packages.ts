/**
 * Materialpaket-registret (Fas 3).
 *
 * Definierar de färdiga produktionspaketen Alex kan beställa åt en studio.
 * Ett paket är en deklarativ spec (vad som ska produceras + vilket recept),
 * som SCC skickar vidare till OpenClaw-producern. OpenClaw hämtar studions
 * IG-material via Apify, bygger annonser (ImageMagick) och film (ffmpeg) enligt
 * receptet, och laddar upp resultatet till studio-material + studio_assets.
 *
 * SCC äger BESTÄLLNINGEN och REGISTRET; OpenClaw äger PRODUKTIONEN.
 */

export interface PackageItem {
    /** Motsvarar studio_assets.kind (ad|video|carousel|...). */
    kind: string;
    count: number;
    /** Människoläsbart recept/mall för det här materialet. */
    spec: string;
}

export interface ProductionPackage {
    id: string;
    name: string;
    description: string;
    items: PackageItem[];
    /** Namnet på OpenClaw-producer-receptet (claw-agent efter claw:). */
    recipe: string;
}

export const PACKAGES: Record<string, ProductionPackage> = {
    'paket-1': {
        id: 'paket-1',
        name: 'Paket 1',
        description: '4 text/bild-annonser + en 30-sekunders film, byggt på studions eget IG-material.',
        items: [
            { kind: 'ad', count: 4, spec: 'Hook- och erbjudande-overlay på utvalda IG-bilder, Anton-font, studions egna färger. Copy i Joakims röst.' },
            { kind: 'video', count: 1, spec: '30s montage, ~8 klipp à ~4,1s ur studions reels, ffmpeg-hopklippt. Musik byts till licensierad i CapCut före skarp körning.' },
        ],
        recipe: 'produce-package',
    },
};

export function getPackage(id: string): ProductionPackage | null {
    return PACKAGES[id] ?? null;
}

export function listPackages(): ProductionPackage[] {
    return Object.values(PACKAGES);
}
