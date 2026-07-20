import { ActivityLog } from '../components/ActivityLog';

/**
 * LoggView — global operatörslogg. Visar hela aktivitetsflödet (alla kunder,
 * alla event) med filter. "Har hänt / händer"-linsen i cockpit-trion
 * Logg / Att göra / Kalender. Återanvänder ActivityLog med customerId=null.
 */
export default function LoggView() {
    return (
        <div
            className="logg-view"
            style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
            <ActivityLog selectedCustomerId={null} />
        </div>
    );
}
