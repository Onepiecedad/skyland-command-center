import { useEffect, useRef, type ReactNode } from 'react';
import './ScrollStrip.css';

/**
 * En rad som inte får plats ska gå att dra med tummen, inte klippas.
 *
 * Bakgrunden: på telefon låg CRM:ets dataset-chips, filterraden och flikarna
 * som vanliga flex-rader utan överflödshantering. Allt bortom skärmkanten var
 * helt onåbart, och det syntes inte ens att det fanns mer.
 *
 * Tre saker gör skillnaden mellan en rullbar rad och en bra rullbar rad:
 *
 *  - Kanttoningen. Utan den ser en avklippt rad ut som en rad som tagit slut.
 *    Masken tonar bara den sida där det faktiskt finns mer att dra fram.
 *  - Snäppet. Utan det landar chipsen halvt utanför kanten efter varje drag.
 *  - Att den aktiva knappen rullas in i bild av sig själv. Byter man vy med
 *    tangentbord eller kommer tillbaka till sidan ska det valda synas, inte
 *    ligga tre skärmbredder bort.
 *
 * Scrollbaren döljs med flit. På touch finns den inte ändå, och på desktop
 * tar den höjd från en rad som är gjord för att vara låg.
 */
interface Props {
    children: ReactNode;
    /** Sätts på den aktiva knappen: [data-aktiv="true"]. Den rullas in i bild. */
    aktivNyckel?: string;
    className?: string;
    'aria-label'?: string;
}

export function ScrollStrip({ children, aktivNyckel, className = '', ...rest }: Props) {
    const ref = useRef<HTMLDivElement>(null);

    // Rulla in det valda. 'nearest' så vi inte rycker raden i onödan när det
    // redan syns, vilket annars gör att den hoppar till vid varje omrendering.
    useEffect(() => {
        const el = ref.current?.querySelector<HTMLElement>('[data-aktiv="true"]');
        // jsdom saknar scrollIntoView. Optional chaining räcker inte: den skyddar
        // mot ett element som inte finns, inte mot en metod som inte finns.
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
        }
    }, [aktivNyckel]);

    // Vilka kanter som ska tonas beror på var man befinner sig i raden.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const uppdatera = () => {
            const kvarVanster = el.scrollLeft > 2;
            const kvarHoger = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
            el.dataset.fadeV = kvarVanster ? '1' : '0';
            el.dataset.fadeH = kvarHoger ? '1' : '0';
        };
        uppdatera();
        el.addEventListener('scroll', uppdatera, { passive: true });
        const ro = new ResizeObserver(uppdatera);
        ro.observe(el);
        return () => { el.removeEventListener('scroll', uppdatera); ro.disconnect(); };
    }, [children]);

    return (
        <div ref={ref} className={`scroll-strip ${className}`} role="tablist" {...rest}>
            {children}
        </div>
    );
}
