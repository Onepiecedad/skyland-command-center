import { Mic, Radio, Languages, MessageSquare, Wand2 } from 'lucide-react';

/**
 * VoiceChatView — Röstchat (Coming Soon)
 * Premium placeholder with orb animation and feature preview.
 */
export default function VoiceChatView() {
    return (
        <div className="voicechat-view">
            {/* Header */}
            <div className="voicechat-header">
                <h1>🎙️ Röstchat</h1>
                <p className="voicechat-subtitle">
                    Prata direkt med Alex via röstkommandon
                </p>
            </div>

            {/* Orb */}
            <div className="voicechat-orb-area">
                <div className="voicechat-orb">
                    <Mic size={36} />
                </div>
            </div>
            <p className="voicechat-label">Tryck för att börja prata</p>

            {/* Status */}
            <div className="voicechat-status">
                <div className="voicechat-status-row">
                    <span className="voicechat-status-label">Status</span>
                    <span className="voicechat-badge voicechat-badge--coming-soon">
                        ⏳ Coming Soon
                    </span>
                </div>
                <div className="voicechat-status-row">
                    <span className="voicechat-status-label">Motor</span>
                    <span className="voicechat-status-value">Whisper + TTS</span>
                </div>
                <div className="voicechat-status-row">
                    <span className="voicechat-status-label">Latens</span>
                    <span className="voicechat-status-value">~500ms (mål)</span>
                </div>
            </div>

            {/* Features */}
            <div className="voicechat-features">
                <h3>Planerade funktioner</h3>
                <div className="voicechat-feature">
                    <div className="voicechat-feature-icon"><Radio size={16} /></div>
                    <div className="voicechat-feature-text">
                        <span className="voicechat-feature-title">Realtidskonversation</span>
                        <span className="voicechat-feature-desc">WebSocket-baserad stream med sub-second responstider</span>
                    </div>
                </div>
                <div className="voicechat-feature">
                    <div className="voicechat-feature-icon"><Languages size={16} /></div>
                    <div className="voicechat-feature-text">
                        <span className="voicechat-feature-title">Svenska & Engelska</span>
                        <span className="voicechat-feature-desc">Automatisk språkdetektering med kontextanpassning</span>
                    </div>
                </div>
                <div className="voicechat-feature">
                    <div className="voicechat-feature-icon"><MessageSquare size={16} /></div>
                    <div className="voicechat-feature-text">
                        <span className="voicechat-feature-title">Transkription</span>
                        <span className="voicechat-feature-desc">Alla samtal sparas som text i chatten</span>
                    </div>
                </div>
                <div className="voicechat-feature">
                    <div className="voicechat-feature-icon"><Wand2 size={16} /></div>
                    <div className="voicechat-feature-text">
                        <span className="voicechat-feature-title">Röstkommandon</span>
                        <span className="voicechat-feature-desc">Styr dashboarden med naturligt tal</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
