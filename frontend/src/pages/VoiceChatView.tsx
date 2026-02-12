import VoiceChat from '../components/VoiceChat';
import '../styles/voicechat.css';

/**
 * VoiceChatView — Real-time voice interface for Alex
 * Uses ElevenLabs Conversational AI via WebRTC
 */
export default function VoiceChatView() {
    return (
        <div className="voicechat-view">
            <div className="voicechat-header">
                <h1>🎙️ Röstchat</h1>
                <p className="voicechat-subtitle">
                    Prata direkt med Alex i realtid
                </p>
            </div>
            <VoiceChat />
        </div>
    );
}
