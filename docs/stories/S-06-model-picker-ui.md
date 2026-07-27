# S-06 — Model picker UI

**Phase:** 2 · **Workstream:** 1 Registry & picker · **Status:** ✅ **Done** (2026-07-27)
**Component:** C-9 (extend `components/chat-workspace.tsx`) · **Traces to:** FR-4.1, FR-4.4
**Depends on:** S-05 · **Blocks:** nothing (S-09 makes it functional end-to-end)

## Goal

Let the user pick a model manually, or switch to **auto** and let the router decide.
This is the first visible Phase-2 win — it makes the registry real.

## Scope

- Fetch `GET /api/models` on mount
- A mode toggle: **Manual** / **Auto**
- Manual: a model `<select>` grouped by provider, showing label + tier
- Auto: hide the selector, show what the router picked **after** each turn
- Send `mode` and (manual only) `model` in the `POST /api/chat` body
- Surface the `RoutingDecision` per assistant turn: chosen model, tier, score, reason,
  and a `degraded` warning when the budget forced a cheaper model (FR-4.4, E-4.b)

## Acceptance criteria

- [ ] Picker lists only enabled models, grouped by provider
- [ ] Manual selection persists across turns within a session
- [ ] Auto mode shows the routing decision for each turn (at minimum: model + reason)
- [ ] A degraded routing decision is visibly flagged, not buried
- [ ] The component calls API routes only — **no provider SDK imports in the UI** (§C)
- [ ] Existing Phase-1 chat and repo-browser behavior is unchanged

## Exceptions honored

- **E-4.b** The user must be able to *see* when auto mode degraded to a cheaper model.
  Silent degradation is a bug.

## Notes / open questions

- Open: where does the routing decision reach the client — a response header, or a data
  part in the AI SDK UI message stream? A stream data part is the better fit for
  per-turn display and survives streaming. Decide in **S-09**; this story consumes
  whatever S-09 emits.
- ⚠️ AI SDK v7 + `@ai-sdk/react` v4 hooks differ from earlier versions. Check the
  installed package's docs before writing the client code.
