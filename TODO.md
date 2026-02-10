# Skyland Command Center — TODO / Backlog

## High Priority

- [ ] **Safari WebSocket fix**: Set up `wss://` for the Alex gateway (e.g. via ngrok/Cloudflare Tunnel) so Safari can connect from the HTTPS Netlify frontend. Currently Safari blocks `ws://` from `https://` pages (mixed content). Chrome works because it exempts localhost.

## Medium Priority

- [ ] Code-split the JS bundle (currently 1.1 MB) using dynamic `import()` for route-level splitting
- [ ] Add error boundary around 3D Realm canvas so WebGL crashes don't take down the whole app

## Low Priority / Nice-to-have

- [ ] Add markdown rendering in chat messages (bold, lists, code blocks)
- [ ] Add timestamps to chat messages
