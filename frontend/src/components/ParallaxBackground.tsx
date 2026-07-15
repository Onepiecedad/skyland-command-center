/**
 * ParallaxBackground — lugn macOS-inspirerad bakgrund.
 * Ersätter det tidigare stjärnfältet (canvas + partiklar): nu en stillsam
 * grafitgradient med två mycket subtila aurora-fält. Ingen animation-loop,
 * ingen GPU-last, inget som stjäl fokus från innehållet.
 */
export function ParallaxBackground() {
    return (
        <>
            <div className="parallax-base" aria-hidden="true" />
            <div className="parallax-nebula parallax-nebula-1" aria-hidden="true" />
            <div className="parallax-nebula parallax-nebula-2" aria-hidden="true" />
        </>
    );
}
