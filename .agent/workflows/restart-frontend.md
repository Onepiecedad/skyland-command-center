---
description: Safely restart the SCC frontend dev server (kill stale processes first)
---

# Restart Frontend Dev Server

Use this workflow whenever you need to restart the SCC frontend, especially after code changes.

**Problem this solves:** Multiple Vite processes can accumulate on port 5173, causing the browser to serve stale code while new processes silently start on different ports.

## Steps

// turbo-all

1. Kill ALL existing Vite processes for SCC:

```bash
kill -9 $(lsof -ti :5173) 2>/dev/null; sleep 1; echo "Port 5173 cleared"
```

1. Start the dev server on port 5173:

```bash
cd /Users/onepiecedad/skyland-command-center/frontend && npm run dev -- --port 5173
```

1. Verify it's running:

```bash
lsof -i :5173 | grep LISTEN
```

## Prevention Tips

- **Never** start a new Vite process without first checking if port 5173 is already in use
- If `npm run dev` says "port already in use", kill the old process first — don't let it auto-pick another port
- Use `lsof -i :5173` to check what's running before starting
