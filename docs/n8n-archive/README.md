# n8n-arkiv

Export av de nio workflows som körde på n8n Cloud (`onepiecedad.app.n8n.cloud`) fram till
2026-08-30. Alla är portade till SCC (se `docs/SITE_FLOWS.md` och `backend/src/routes/marinmekanikerWebhook.ts`).
Hemligheter är maskerade. Filerna finns för referens, inte för drift. n8n är avvecklat.

| Workflow | Portad till |
|---|---|
| session_init, track_event, session_status, void_submission, rag_query, voice_call_ended | `backend/src/routes/siteWebhooks.ts` |
| MarinMekaniker_Ordernotifiering (två versioner) | `backend/src/routes/marinmekanikerWebhook.ts` |
| ig_dm_autosvar | inte portad (var inte i drift; IG-DM hanteras av `igDmWebhook.ts` + Alex) |
