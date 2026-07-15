/**
 * CharacterSheet — rollformulär i Drakar & Demoner-anda för Alex + sub-agenter.
 * Öppnas som popup från Kontoret (klick på skrivbord) och Alex-vyn (klick på avatar).
 * Statisk profil ur agentProfiles.ts + valfri live-data (status, senaste aktivitet).
 */

import { AnimatePresence, motion } from 'framer-motion';
import { X, Swords, Wrench, ScrollText, Crown, Cpu } from 'lucide-react';
import { AGENT_PROFILES } from '../data/agentProfiles';
import '../styles/character-sheet.css';

export interface AgentLiveInfo {
    status?: string;          // "Jobbar" / "Ledig" / ...
    lastActivity?: string;    // ISO-tid
    lastMessage?: string;     // senaste output (trunkeras)
    tokenCount?: number;
}

interface CharacterSheetProps {
    agentId: string | null;   // null = stängd
    live?: AgentLiveInfo;
    onClose: () => void;
}

function timeAgo(iso?: string): string {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(mins) || mins < 0) return '';
    if (mins < 1) return 'nyss';
    if (mins < 60) return `${mins} min sedan`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h} h sedan`;
    return `${Math.floor(h / 24)} d sedan`;
}

export function CharacterSheet({ agentId, live, onClose }: CharacterSheetProps) {
    const profile = agentId ? AGENT_PROFILES[agentId] : undefined;

    return (
        <AnimatePresence>
            {profile && (
                <motion.div
                    className="csheet-backdrop"
                    onClick={onClose}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <motion.div
                        className="csheet"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ opacity: 0, y: 26, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 26, scale: 0.96 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                    >
                        <button className="csheet-close" onClick={onClose} title="Stäng (Esc)">
                            <X size={16} />
                        </button>

                        {/* ── Huvud: avatar + namn ── */}
                        <div className="csheet-header">
                            <div className="csheet-avatar">
                                <img src={profile.avatar} alt={profile.name} />
                                {live?.status && (
                                    <span className={`csheet-status ${live.status === 'Jobbar' ? 'csheet-status--active' : ''}`}>
                                        {live.status}
                                    </span>
                                )}
                            </div>
                            <div className="csheet-title">
                                <h2>{profile.name}</h2>
                                <div className="csheet-klass">{profile.klass}</div>
                                <div className="csheet-epithet">"{profile.epithet}"</div>
                                <div className="csheet-chips">
                                    <span className="csheet-chip"><Cpu size={11} /> {profile.model}</span>
                                    <span className="csheet-chip"><Crown size={11} /> {profile.reportsTo}</span>
                                </div>
                            </div>
                        </div>

                        {/* ── Uppdrag ── */}
                        <div className="csheet-section">
                            <h3><ScrollText size={13} /> Uppdrag</h3>
                            <p>{profile.purpose}</p>
                        </div>

                        {/* ── Förmågor + Verktyg ── */}
                        <div className="csheet-grid">
                            <div className="csheet-section">
                                <h3><Swords size={13} /> Förmågor</h3>
                                <ul>
                                    {profile.abilities.map(a => <li key={a}>{a}</li>)}
                                </ul>
                            </div>
                            <div className="csheet-section">
                                <h3><Wrench size={13} /> Verktyg</h3>
                                <ul>
                                    {profile.tools.map(t => <li key={t}><code>{t}</code></li>)}
                                </ul>
                            </div>
                        </div>

                        {/* ── Eder ── */}
                        <div className="csheet-section csheet-oaths">
                            <h3>⚔️ Eder — bryts aldrig</h3>
                            <ul>
                                {profile.oaths.map(o => <li key={o}>{o}</li>)}
                            </ul>
                        </div>

                        {/* ── Live-status ── */}
                        {(live?.lastActivity || live?.lastMessage || live?.tokenCount) && (
                            <div className="csheet-section csheet-live">
                                <h3>◉ Senaste aktivitet</h3>
                                {live.lastActivity && <div className="csheet-live-row">Aktiv: {timeAgo(live.lastActivity)}</div>}
                                {typeof live.tokenCount === 'number' && live.tokenCount > 0 && (
                                    <div className="csheet-live-row">Tokens denna session: {live.tokenCount.toLocaleString('sv-SE')}</div>
                                )}
                                {live.lastMessage && (
                                    <div className="csheet-live-msg">"{live.lastMessage.slice(0, 180)}{live.lastMessage.length > 180 ? '…' : ''}"</div>
                                )}
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
