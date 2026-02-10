import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import AgentGrid from '../components/fleet/AgentGrid';
import AgentDetailPanel from '../components/fleet/AgentDetailPanel';
import ReasoningStream from '../components/fleet/ReasoningStream';
import CommFlowGraph from '../components/fleet/CommFlowGraph';
import ActivityTimeline from '../components/fleet/ActivityTimeline';
import type { AgentData } from '../gateway/fleetApi';
import { useGateway } from '../gateway/useGateway';

export default function FleetMonitor() {
    const [selectedAgent, setSelectedAgent] = useState<AgentData | null>(null);
    const [agents, setAgents] = useState<AgentData[]>([]);

    // Live gateway connection for reasoning stream
    const { messages, alexState, isStreaming } = useGateway('agent:skyland:main');

    return (
        <div className="fleet-monitor">
            {/* Main content */}
            <main className="fleet-main">
                <AgentGrid
                    onSelectAgent={setSelectedAgent}
                    onAgentsLoaded={setAgents}
                />
                <ActivityTimeline agents={agents} />
            </main>

            {/* Sidebar */}
            <aside className="fleet-sidebar">
                <ReasoningStream
                    messages={messages}
                    alexState={alexState}
                    isStreaming={isStreaming}
                />
                <CommFlowGraph agents={agents} />
            </aside>

            {/* Detail panel overlay */}
            <AnimatePresence>
                {selectedAgent && (
                    <motion.div
                        key="detail"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    >
                        <AgentDetailPanel
                            agent={selectedAgent}
                            onClose={() => setSelectedAgent(null)}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
