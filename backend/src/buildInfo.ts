/**
 * Build/deploy identity.
 *
 * Without this, "is my fix live yet?" can only be answered by guessing, or by
 * poking the app until it behaves differently. /health now states which commit
 * is actually running.
 *
 * Sources, in order:
 *   RENDER_GIT_COMMIT      — injected by Render for its services
 *   RAILWAY_GIT_COMMIT_SHA — injected by Railway
 *   GIT_COMMIT             — generic; baked in at image build (see Dockerfile)
 */
const RAW_COMMIT =
    process.env.RENDER_GIT_COMMIT ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    '';

export const BUILD_INFO = {
    /** Full SHA, or 'unknown' when no source supplied one. */
    commit: RAW_COMMIT || 'unknown',
    /** Short SHA — this is what you compare against `git log --oneline`. */
    commitShort: RAW_COMMIT ? RAW_COMMIT.slice(0, 7) : 'unknown',
    /** Process boot time. A change here means a new instance started. */
    startedAt: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
} as const;
