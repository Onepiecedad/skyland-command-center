import { useState, useEffect, useCallback } from 'react';
import {
    GitBranch, RefreshCw, Plus, Check, Upload,
    AlertTriangle, FileText, ChevronDown, ChevronUp
} from 'lucide-react';
import { fetchGitStatus, fetchGitDiff, gitAdd, gitCommit, gitPush } from '../../api';

type GitFileStatus = { status: string; file: string };

export function GitPanel() {
    const [branch, setBranch] = useState<string>('');
    const [clean, setClean] = useState(true);
    const [files, setFiles] = useState<GitFileStatus[]>([]);
    const [lastCommit, setLastCommit] = useState<{ hash: string; subject: string; date: string } | null>(null);
    const [diff, setDiff] = useState<string>('');
    const [showDiff, setShowDiff] = useState(false);
    const [commitMsg, setCommitMsg] = useState('');
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

    const loadStatus = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchGitStatus();
            setBranch(data.branch);
            setClean(data.clean);
            setFiles(data.files);
            setLastCommit(data.last_commit);
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Git status failed' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadStatus();
        const interval = setInterval(loadStatus, 30000); // poll every 30s
        return () => clearInterval(interval);
    }, [loadStatus]);

    const handleLoadDiff = async () => {
        if (showDiff) {
            setShowDiff(false);
            return;
        }
        try {
            const data = await fetchGitDiff();
            setDiff(data.diff);
            setShowDiff(true);
        } catch {
            setFeedback({ type: 'error', message: 'Kunde inte ladda diff' });
        }
    };

    const handleStageAll = async () => {
        setActionLoading('add');
        try {
            await gitAdd(['.']);
            setFeedback({ type: 'success', message: 'Alla filer stagede' });
            await loadStatus();
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Stage failed' });
        } finally {
            setActionLoading(null);
        }
    };

    const handleCommit = async () => {
        if (!commitMsg.trim()) {
            setFeedback({ type: 'warning', message: 'Skriv ett commit-meddelande' });
            return;
        }
        setActionLoading('commit');
        try {
            const result = await gitCommit(commitMsg);
            setFeedback({ type: 'success', message: `Commit ${result.commit_hash}: ${commitMsg}` });
            setCommitMsg('');
            await loadStatus();
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Commit failed' });
        } finally {
            setActionLoading(null);
        }
    };

    const handlePush = async () => {
        setActionLoading('push');
        try {
            const result = await gitPush();
            if (result.error === 'APPROVAL_REQUIRED') {
                setFeedback({
                    type: 'warning',
                    message: `⚠️ ${result.message || 'Push till skyddad branch kräver godkännande'}`,
                });
            } else {
                setFeedback({ type: 'success', message: `Push till ${result.branch || branch} klar` });
            }
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Push failed' });
        } finally {
            setActionLoading(null);
        }
    };

    // Auto-dismiss feedback
    useEffect(() => {
        if (feedback) {
            const t = setTimeout(() => setFeedback(null), 5000);
            return () => clearTimeout(t);
        }
    }, [feedback]);

    const statusLabel = (code: string) => {
        const map: Record<string, string> = {
            'M': 'Ändrad', 'A': 'Ny', 'D': 'Borttagen', '??': 'Ospårad',
            'MM': 'Ändrad', 'AM': 'Ny+Ändrad', 'R': 'Renamed',
        };
        return map[code] || code;
    };

    return (
        <div className="git-panel glass-card">
            {/* Header */}
            <div className="git-panel-header">
                <h3 className="git-panel-title">
                    <GitBranch size={16} />
                    Git Status
                </h3>
                <div className="git-panel-actions-top">
                    <span className="git-branch-badge">{branch || '...'}</span>
                    <button className="git-refresh-btn" onClick={loadStatus} disabled={loading} title="Uppdatera Git-status">
                        <RefreshCw size={12} className={loading ? 'spinning' : ''} />
                    </button>
                </div>
            </div>

            {/* Status summary */}
            <div className="git-status-summary">
                {clean ? (
                    <span className="git-clean-badge">✓ Ren arbetsyta</span>
                ) : (
                    <span className="git-dirty-badge">
                        <AlertTriangle size={12} />
                        {files.length} ändrade filer
                    </span>
                )}
                {lastCommit && (
                    <span className="git-last-commit" title={lastCommit.hash}>
                        Senast: {lastCommit.subject?.slice(0, 40)}{(lastCommit.subject?.length ?? 0) > 40 ? '...' : ''}
                    </span>
                )}
            </div>

            {/* Changed files list */}
            {files.length > 0 && (
                <div className="git-files-list">
                    {files.slice(0, 15).map((f, i) => (
                        <div key={i} className="git-file-item">
                            <span className={`git-file-status git-file-status--${f.status.includes('D') ? 'deleted' : f.status.includes('A') || f.status === '??' ? 'added' : 'modified'}`}>
                                {statusLabel(f.status)}
                            </span>
                            <span className="git-file-name">
                                <FileText size={11} />
                                {f.file}
                            </span>
                        </div>
                    ))}
                    {files.length > 15 && (
                        <div className="git-files-more">+{files.length - 15} fler filer</div>
                    )}
                </div>
            )}

            {/* Diff toggle */}
            <button className="git-diff-toggle" onClick={handleLoadDiff}>
                {showDiff ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showDiff ? 'Dölj diff' : 'Visa diff'}
            </button>

            {showDiff && (
                <div className="git-diff-container">
                    <pre className="git-diff-content">{diff || '(ingen diff)'}</pre>
                </div>
            )}

            {/* Actions */}
            {!clean && (
                <div className="git-actions">
                    <button
                        className="git-action-btn git-stage-btn"
                        onClick={handleStageAll}
                        disabled={actionLoading === 'add'}
                    >
                        <Plus size={12} />
                        Stage alla
                    </button>

                    <div className="git-commit-group">
                        <input
                            type="text"
                            className="git-commit-input"
                            placeholder="Commit-meddelande..."
                            value={commitMsg}
                            onChange={(e) => setCommitMsg(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
                        />
                        <button
                            className="git-action-btn git-commit-btn"
                            onClick={handleCommit}
                            disabled={actionLoading === 'commit' || !commitMsg.trim()}
                        >
                            <Check size={12} />
                            Commit
                        </button>
                    </div>

                    <button
                        className="git-action-btn git-push-btn"
                        onClick={handlePush}
                        disabled={actionLoading === 'push'}
                    >
                        <Upload size={12} />
                        Push
                    </button>
                </div>
            )}

            {/* Feedback toast */}
            {feedback && (
                <div className={`git-feedback git-feedback-${feedback.type}`}>
                    {feedback.message}
                </div>
            )}
        </div>
    );
}
