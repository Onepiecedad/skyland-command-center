/**
 * Svarsklassificering (plan 3.1)
 *
 * Varje inkommande mejl klassas: intresserad, nej, autosvar, fråga eller övrigt.
 * Klassen sparas på meddelandet, kortet flyttas, och ett nej spärrar adressen.
 *
 * Tre principer som styr designen, alla dyrköpta:
 *
 * 1. **Klassificeringen får aldrig fälla inmatningen.** Mejlet ska loggas och
 *    vidarebefordras även om OpenRouter är nere. Därför är hela kedjan best-effort
 *    och kastar aldrig uppåt — precis som integrationshälsan.
 *
 * 2. **Osäkra bedömningar agerar inte.** Modellen returnerar en säkerhet, och under
 *    tröskeln sparas klassen men kortet flyttas inte och ingen spärras. Ett
 *    felklassat "nej" spärrar en kund som ville köpa; det felet får inte gå
 *    automatiskt.
 *
 * 3. **Regler före modell för det entydiga.** Autosvar känns igen på rubrik och
 *    headers utan att kosta ett LLM-anrop. Det är billigare, snabbare och mer
 *    förutsägbart än att fråga en modell om "Ur kontoret till 15/9".
 */
import { getAdapter } from '../llm/adapter';
import { config } from '../config';
import { supabase } from './supabase';
import { addSuppression } from './outreach';
import { logger } from './logger';

export type ReplyIntent = 'interested' | 'no' | 'autoreply' | 'question' | 'other';

export interface Classification {
    intent: ReplyIntent;
    confidence: number;
    reason: string;
    /** true när klassen kom från regler i stället för modellen. */
    byRule?: boolean;
}

/**
 * Autosvar är regelbara. Träffar här slipper LLM helt.
 *
 * Gränserna skrivs som (?<![\p{L}]) / (?![\p{L}]) med u-flaggan i stället för \b:
 * JS:s \b är ASCII-baserad, så "å", "ä" och "ö" räknas inte som ordtecken. Ett
 * mönster som /\bär på semester\b/ matchar därför aldrig "Jag är på semester",
 * eftersom det inte finns någon ordgräns mellan mellanslaget och "ä".
 */
const AUTOREPLY_PATTERNS: RegExp[] = [
    /(?<!\p{L})(out of office|ur kontoret|autosvar|auto-?reply|automatiskt svar)(?!\p{L})/iu,
    /(?<!\p{L})(semester|föräldraledig|tjänstledig|sjukskriven)(?!\p{L}).*(?<!\p{L})(tillbaka|åter)/iu,
    /(?<!\p{L})(är på semester|har semester|återkommer efter)(?!\p{L})/iu,
    /(?<!\p{L})thank you for your (email|message)(?!\p{L}).*(automatically|automatic)(?!\p{L})/iu,
    /(?<!\p{L})detta är ett automatiskt (svar|meddelande)(?!\p{L})/iu,
];

/** Rubrikprefix som alltid betyder maskin, aldrig människa. */
const AUTOREPLY_SUBJECTS = /^(auto(matic)?[-\s]?(reply|svar)|out of office|frånvaro|automatiskt svar)/i;

export function classifyByRules(subject: string, text: string): Classification | null {
    if (AUTOREPLY_SUBJECTS.test(subject.trim())) {
        return { intent: 'autoreply', confidence: 0.95, reason: 'rubriken är ett autosvarsprefix', byRule: true };
    }
    const hay = `${subject}\n${text}`;
    for (const re of AUTOREPLY_PATTERNS) {
        if (re.test(hay)) {
            return { intent: 'autoreply', confidence: 0.9, reason: 'frånvaroformulering i texten', byRule: true };
        }
    }
    return null;
}

const SYSTEM_PROMPT = `Du klassar svar på kall B2B-outreach till svenska tatuerings- och skönhetskliniker.

Svara ENDAST med JSON: {"intent":"...","confidence":0.0-1.0,"reason":"kort motivering på svenska"}

intent är exakt en av:
- "interested" — visar intresse, ställer köpfråga, vill veta mer, vill boka
- "no" — tackar nej, avböjer, ber att inte bli kontaktad igen
- "autoreply" — frånvaro-/semestersvar eller annat maskinsvar
- "question" — frågar något men utan att visa intresse eller avböja (t.ex. "vem är ni?")
- "other" — går inte att placera i ovanstående

confidence ska spegla verklig osäkerhet. Är svaret kort, tvetydigt eller ironiskt: sätt lågt.
Ett svalt "kanske senare" är INTE "interested". Ett "nej tack just nu" ÄR "no".`;

function parseClassification(raw: string): Classification | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        const o = JSON.parse(match[0]) as Record<string, unknown>;
        const intent = String(o.intent ?? '') as ReplyIntent;
        if (!['interested', 'no', 'autoreply', 'question', 'other'].includes(intent)) return null;
        const confRaw = Number(o.confidence);
        const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0;
        return { intent, confidence, reason: String(o.reason ?? '').slice(0, 300) };
    } catch {
        return null;
    }
}

/** Klassa ett svar. Returnerar null när modellen inte gick att nå eller svarade obegripligt. */
export async function classifyReply(subject: string, text: string): Promise<Classification | null> {
    const byRule = classifyByRules(subject, text);
    if (byRule) return byRule;

    try {
        const out = await getAdapter().chat({
            systemPrompt: SYSTEM_PROMPT,
            messages: [{
                role: 'user',
                content: `Rubrik: ${subject}\n\nBrödtext:\n${text.slice(0, 4000)}`,
            }],
        });
        const parsed = parseClassification(out.text ?? '');
        if (!parsed) {
            logger.warn('replyClassifier', `obegripligt modellsvar: ${(out.text ?? '').slice(0, 120)}`);
            return null;
        }
        return parsed;
    } catch (err) {
        logger.warn('replyClassifier', `klassificering misslyckades: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}

/** Vilket stegnamn en klass ska landa i, eller null när kortet inte ska flyttas. */
export function targetStageName(intent: ReplyIntent): string | null {
    switch (intent) {
        case 'interested':
        case 'question':
            return 'Replied';
        case 'no':
            return 'No Fit';
        // Autosvar betyder ingenting om intresset — låt kortet stå kvar.
        case 'autoreply':
        case 'other':
        default:
            return null;
    }
}

async function moveCard(contactId: string, stageName: string): Promise<boolean> {
    const { data: opps } = await supabase
        .from('opportunities')
        .select('id, stage_id, stages(name, pipeline_id)')
        .eq('contact_id', contactId)
        .limit(5);
    const opp = (opps ?? [])[0] as { id: string; stages?: { pipeline_id?: string } | { pipeline_id?: string }[] } | undefined;
    if (!opp) return false;

    const stages = Array.isArray(opp.stages) ? opp.stages[0] : opp.stages;
    const pipelineId = stages?.pipeline_id;
    if (!pipelineId) return false;

    const { data: target } = await supabase
        .from('stages').select('id').eq('pipeline_id', pipelineId).eq('name', stageName).maybeSingle();
    if (!target) return false;

    await supabase.from('opportunities')
        .update({ stage_id: (target as { id: string }).id, updated_at: new Date().toISOString() })
        .eq('id', opp.id);
    return true;
}

export interface ApplyResult {
    intent: ReplyIntent | null;
    confidence: number;
    acted: boolean;
    moved: boolean;
    suppressed: boolean;
}

/**
 * Klassa och agera. Best-effort hela vägen: fel loggas, inget kastas uppåt.
 * `acted` är false när säkerheten låg under tröskeln — klassen sparas ändå, så
 * digesten kan visa vad som väntar på manuell bedömning.
 */
export async function classifyAndApply(params: {
    contactId: string;
    customerId: string | null;
    fromEmail: string;
    subject: string;
    text: string;
}): Promise<ApplyResult> {
    const { contactId, customerId, fromEmail, subject, text } = params;
    const empty: ApplyResult = { intent: null, confidence: 0, acted: false, moved: false, suppressed: false };

    if (!config.REPLY_CLASSIFIER_ENABLED) return empty;

    const c = await classifyReply(subject, text);
    if (!c) return empty;

    const threshold = config.REPLY_CLASSIFIER_MIN_CONFIDENCE;
    const acted = c.confidence >= threshold;
    let moved = false;
    let suppressed = false;

    if (acted) {
        const stage = targetStageName(c.intent);
        if (stage) {
            try { moved = await moveCard(contactId, stage); }
            catch (err) { logger.warn('replyClassifier', `kunde inte flytta kort: ${err instanceof Error ? err.message : err}`); }
        }
        if (c.intent === 'no') {
            try {
                await addSuppression('email', fromEmail, 'reply_no', 'reply-classifier', contactId);
                suppressed = true;
            } catch (err) {
                logger.warn('replyClassifier', `kunde inte spärra: ${err instanceof Error ? err.message : err}`);
            }
        }
    }

    try {
        await supabase.from('activities').insert({
            customer_id: customerId, agent: 'system:reply-classifier', event_type: 'message',
            action: acted ? 'reply.classified' : 'reply.classified.low_confidence',
            severity: c.intent === 'no' ? 'warn' : 'info',
            details: {
                contact_id: contactId, from: fromEmail, subject,
                intent: c.intent, confidence: c.confidence, reason: c.reason,
                by_rule: c.byRule ?? false, threshold, moved, suppressed,
            },
        });
    } catch (err) {
        logger.warn('replyClassifier', `kunde inte logga: ${err instanceof Error ? err.message : err}`);
    }

    logger.info('replyClassifier',
        `${fromEmail}: ${c.intent} (${c.confidence.toFixed(2)}${c.byRule ? ', regel' : ''})` +
        `${acted ? '' : ' — under tröskel, ingen åtgärd'}${moved ? ', kort flyttat' : ''}${suppressed ? ', spärrad' : ''}`);

    return { intent: c.intent, confidence: c.confidence, acted, moved, suppressed };
}
