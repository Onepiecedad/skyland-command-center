/**
 * uiActions — bryggan som låter Alex (chatt OCH röst) styra dashboardens UI.
 *
 * Backend-verktyget navigate_ui emittar ett `ui_action`-event på SSE-hubben
 * (/events/stream). Här mappas den logiska vyn till korsets panel + undervy
 * och skickas vidare som window-CustomEvents som komponenterna lyssnar på:
 *   - 'scc:focus-pane'   { pane }                      → FocusNavigator
 *   - 'scc:subview'      { subview }                   → SubViewPane
 *   - 'scc:open-contact' { contactId, contactName }    → PipelineBoard
 */

import { connectEventStream } from './../api/system';

interface PaneTarget {
    pane: string;
    subview?: string;
}

/** Logisk vy (som Alex känner den) → panel i korset + ev. undervy */
const VIEW_TO_PANE: Record<string, PaneTarget> = {
    alex: { pane: 'alex' },
    crm: { pane: 'sales', subview: 'crm' },
    leads: { pane: 'sales', subview: 'leads' },
    sequences: { pane: 'sales', subview: 'sequences' },
    customers: { pane: 'customers' },
    website: { pane: 'content', subview: 'website' },
    office: { pane: 'content', subview: 'office' },
    archive: { pane: 'content', subview: 'archive' },
    system: { pane: 'system', subview: 'system' },
    skills: { pane: 'system', subview: 'skills' },
};

export interface OpenContactDetail {
    contactId: string;
    contactName: string | null;
}

interface UiActionData {
    action?: string;
    view?: string;
    contact_id?: string | null;
    contact_name?: string | null;
}

function handleUiAction(data: UiActionData): void {
    if (data.action !== 'navigate') return;

    const target = data.view ? VIEW_TO_PANE[data.view] : undefined;
    if (target) {
        window.dispatchEvent(new CustomEvent('scc:focus-pane', { detail: { pane: target.pane } }));
        if (target.subview) {
            window.dispatchEvent(new CustomEvent('scc:subview', { detail: { subview: target.subview } }));
        }
    }
    if (data.contact_id) {
        window.dispatchEvent(new CustomEvent<OpenContactDetail>('scc:open-contact', {
            detail: { contactId: data.contact_id, contactName: data.contact_name ?? null },
        }));
    }
}

/** Anslut SSE-strömmen. Returnerar cleanup. Återansluter automatiskt via EventSource. */
export function subscribeUiActions(): () => void {
    const es = connectEventStream(
        (event) => handleUiAction(event.data as UiActionData),
        { types: 'ui_action' },
    );
    return () => es.close();
}
