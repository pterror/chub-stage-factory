# TODO

## Persistence — open verification gap

The dev TestRunner (`src/TestRunner.tsx`) runs a stage in isolation and
does **not** simulate Chub's message tree, swipes, or branch navigation.
So the per-branch behavior assumption in `persistence/chub.ts` —
specifically that `setState(messageState)` fires on every swipe / tree
jump and carries the host's per-branch messageState snapshot — is
**unverified locally**. The Chub TypeScript declaration confirms the
intent:

> `setState(state: MessageStateType): Promise<void>` — "This can be
> called at any time, typically after a jump to a different place in the
> chat tree or a swipe."
> (`node_modules/@chub-ai/stages-ts/dist/types/stage.d.ts`)

But "typically" is not a guarantee, and the actual host behavior needs
on-platform smoke tests. Specifically:

1. **inventory example**: take an item via `<take>` tag, then swipe the
   user prompt. Expected: the taken item returns to its spot. If not,
   the chubTreeHistory shard is not getting a fresh setState call.
2. **tits-body example**: drink a tincture, then swipe. Expected: the
   transformation persists (chatState + forbidBranching is canon). This
   should work regardless of setState behavior because chatState is the
   host's responsibility.
3. **composite-showcase**: hit "Save Slot" mid-shop, install something,
   hit "Load Slot". Expected: install undone, slot state restored.

### Fallback if (1) does not behave

If the host does not call setState on branch nav, the chubTreeHistory
shard will silently desync from the host's view. The fallback would be
to inject the cursor's MomentId into the messageState payload itself
(e.g. a `__cursor` key per shard), and on each beforePrompt check
whether the host's last-seen cursor matches our local history's cursor.
A mismatch means a branch jump we missed; we'd navigate the local
history to the host's cursor (or commit a sibling). The infrastructure
(`history.navigate`, `store.navigateAll`) is already in place — only
the cursor-tracking wiring in chub.ts would need to be added.

Filed here because it requires real Chub host behavior to confirm.
