# BLACKHOLE Jarvis → Shadow Army Bridge

Date: 2026-09-20  
Base: PR #30 head `59f1fbb1b2163cf52e69d1f9883f77b11c6f51ba`

## Scope

This slice connects an existing, owner-created proposed Quest to the existing Phase D Shadow Army mission planner.

`POST /api/shadow-army/missions` may now receive `questId` instead of duplicating the goal and success criterion. The core:

1. Reads the real proposed Quest and its existing project.
2. Rejects a missing project, changed goal, changed success criterion, already-executing Quest, or an existing live mission for that Quest.
3. Creates the same four durable Shadow jobs (scout, researcher, builder, verifier).
4. Stores `plannerQuestId` inside each Shadow assignment.
5. Exposes the link through `GET /api/quests/:id/shadow-missions`.
6. Prevents the generic `/api/quests/decide` route from launching a second job while a linked Shadow mission is active or completed.
7. Preserves the link through restart because it is part of the existing job records.

No new job engine, planner engine, provider, verifier, JEV authority, or production connection is introduced.

## Evidence boundary

The tests use the real HTTP server and durable store on a temporary directory. The model provider is intentionally unavailable, so Shadow workers pause with the existing `providerMissing` contract. This proves planning, linking, duplicate prevention, and restart durability; it does not prove a live provider call, semantic quality, APK behavior, or external outcome.

## Safety

- `requestId` remains required and the owner authentication/mutation ledger remains in force.
- Existing JEV Shadow Mode and `authorizesDispatch:false` are untouched.
- No external message, payment, deployment, or production data is changed.
- Failed/cancelled missions remain retryable only through an explicit mission request; active/completed linked missions cannot be duplicated by generic Quest selection.

## Rollback

Close this Draft PR or revert its commits. The base PR #30 remains unchanged; no production branch is touched.
