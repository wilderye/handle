# Undercover Public Vote Relations Implementation Plan

> **Execution:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each living player's current vote target directly in the existing undercover vote panel text.

**Architecture:** Keep the current Discord interaction model unchanged: players still vote through the existing button and private select menu, and hosts still close votes with the existing button. Add one small formatting helper that renders `voter -> target` relationships from the existing `currentVote.votes` map, then use it in the vote panel.

**Tech Stack:** TypeScript, discord.js v14, existing `UndercoverEngine`, existing `src/test-undercover.ts` smoke/integration tests.

---

## Scope

### Confirmed Facts

- `src/game/undercover.ts` stores votes as `Record<voterId, targetUserId>` in `UndercoverCurrentVote.votes`.
- `UndercoverEngine.castVote(channelId, voterId, targetUserId)` already enforces that the voter is alive and the target is alive.
- `src/commands/undercover.ts` currently builds the vote panel in `buildVotePanel(...)`.
- The current vote panel shows the living player list and the aggregate vote count, but not the voter-to-target relationship.
- The current voting UI is `[投票] [查看历史] [结束投票]`; `查看历史` must be preserved.

### Evidence-Based Judgment

- The minimum effective change is to add text to the current vote panel instead of moving to reaction voting.
- This avoids the reaction-message persistence problem: new Discord messages cannot inherit old users' reactions.
- This also keeps existing vote state, revote behavior, private select menus, vote closing, tie handling, and elimination behavior unchanged.

### Product Behavior

Before:

```text
**当前存活玩家：**
1. 小明
2. 小红
3. 小蓝
4. 小绿
```

After:

```text
**当前存活玩家：**
1. 小明 -> 小红
2. 小红 -> 小蓝
3. 小蓝
4. 小绿
```

Use ASCII `->` in source text unless the project already accepts a Unicode arrow in this file. If product wording requires the visual arrow exactly as discussed, use `→` in this one user-facing string.

The aggregate section remains:

```text
**当前得票：**
2. 小红：1 票
3. 小蓝：1 票
```

### Non-Goals

- Do not add reaction voting.
- Do not remove the `投票` button.
- Do not remove or change `查看历史`.
- Do not change vote closing rules.
- Do not change participant limits.
- Do not change role assignment, speech, or history behavior.

---

## File Structure

- Modify: `src/game/undercover.ts`
  - Add and export `formatUndercoverPlayerVoteList(...)`.
  - Keep `formatUndercoverPlayerList(...)` unchanged for speech order and other panels.

- Modify: `src/commands/undercover.ts`
  - Import `formatUndercoverPlayerVoteList`.
  - Use it inside `buildVotePanel(...)` for the `当前存活玩家` section.
  - Leave `voteActionRow(...)` unchanged so `[投票] [查看历史] [结束投票]` remains.

- Modify: `src/test-undercover.ts`
  - Add unit coverage for the new formatter.
  - Add panel-level coverage that a refreshed vote panel shows `voter -> target` while preserving `查看历史`.

---

## Task 1: Add Vote Relationship Formatter

**Files:**
- Modify: `src/game/undercover.ts`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Write the failing formatter test**

In `src/test-undercover.ts`, extend the import from `./game/undercover.js` to include the new formatter:

```ts
import {
  formatBooleanRule,
  formatEndReveal,
  formatHostSecret,
  formatLobbyMessage,
  formatPreparedEnd,
  formatSpeechOrder,
  formatUndercoverPlayerList,
  formatUndercoverPlayerVoteList,
  formatUndercoverVoteOptions,
  formatUndercoverVoteStatus,
  getRandomUndercoverWordPair,
  getVoteReminderOffsets,
  shouldSendVoteEndingSoon,
} from './game/undercover.js'
```

Add this test near the existing player-list and vote-status tests:

```ts
const voteRelationPlayers = [
  { userId: 'u1', number: 1, displayName: '小明' },
  { userId: 'u2', number: 2, displayName: '小红' },
  { userId: 'u3', number: 3, displayName: '小蓝' },
  { userId: 'u4', number: 4, displayName: '小绿' },
]

assert.equal(
  formatUndercoverPlayerVoteList(voteRelationPlayers, {
    u1: 'u2',
    u2: 'u3',
    outsider: 'u1',
    u3: 'missing-target',
  }),
  '1. 小明 -> 小红\n2. 小红 -> 小蓝\n3. 小蓝\n4. 小绿',
)
console.log('✅ 投票面板玩家列表会公开显示存活玩家当前投给谁，并忽略无效票')
```

This defines the edge behavior:

- Valid living voter + valid living target: show `voter -> target`.
- Living voter + invalid target: show voter without an arrow.
- Non-living voter: ignore it because that user is not in the displayed living player list.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
SyntaxError or TypeScript error because formatUndercoverPlayerVoteList is not exported
```

- [ ] **Step 3: Implement the formatter**

In `src/game/undercover.ts`, add this function immediately after `formatUndercoverPlayerList(...)`:

```ts
export function formatUndercoverPlayerVoteList(
  players: DisplayNumberedPlayer[],
  votes: Record<string, string>,
): string {
  const playersByUserId = new Map(players.map(player => [player.userId, player]))

  return players
    .map(player => {
      const targetUserId = votes[player.userId]
      const target = targetUserId ? playersByUserId.get(targetUserId) : undefined
      const base = `${player.number}. ${sanitizeDisplayName(player.displayName)}`
      return target
        ? `${base} -> ${sanitizeDisplayName(target.displayName)}`
        : base
    })
    .join('\n')
}
```

Do not modify `formatUndercoverPlayerList(...)`; other panels use it and should stay visually unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
All existing test logs continue, plus:
✅ 投票面板玩家列表会公开显示存活玩家当前投给谁，并忽略无效票
```

---

## Task 2: Show Vote Relations in the Real Vote Panel

**Files:**
- Modify: `src/commands/undercover.ts`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Write the failing panel test**

In `src/test-undercover.ts`, update the existing resurface vote panel test around the `undercover-resurface-channel` setup.

After the existing vote:

```ts
await UndercoverEngine.castVote(resurfaceChannelId, 'v1', 'v2')
```

add a second vote:

```ts
await UndercoverEngine.castVote(resurfaceChannelId, 'v2', 'v3')
```

Then update the existing assertions after `resurfaceReply` is captured:

```ts
assert.equal(getPanelText(resurfaceReply).includes('谁是卧底投票'), true)
assert.equal(getPanelText(resurfaceReply).includes('1. 玩家v1 -> 玩家v2'), true)
assert.equal(getPanelText(resurfaceReply).includes('2. 玩家v2 -> 玩家v3'), true)
assert.equal(getPanelText(resurfaceReply).includes('查看历史'), true)
assert.equal(deletedOldPanel, true)
assert.equal(resurfacedVote?.messageId, 'new-panel')
assert.equal(resurfacedVote?.endsAt, originalVote?.endsAt)
assert.deepEqual(resurfacedVote?.votes, { v1: 'v2', v2: 'v3' })
assert.equal(resurfaceFollowUp.ephemeral, true)
assert.equal(resurfaceFollowUp.content.includes('讨论时间不变'), true)
```

This test verifies:

- The real vote panel shows voter-to-target relationships.
- `查看历史` remains present in the vote panel components.
- Existing resurface behavior and vote persistence are unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
AssertionError because the vote panel still renders "1. 玩家v1" without "-> 玩家v2"
```

- [ ] **Step 3: Import the formatter in the command file**

In `src/commands/undercover.ts`, add `formatUndercoverPlayerVoteList` to the existing import from `../game/undercover.js`:

```ts
import {
  formatBooleanRule,
  formatAudiencePeek,
  formatEndReveal,
  formatHostSecret,
  formatLobbyMessage,
  formatUndercoverPlayerList,
  formatUndercoverPlayerVoteList,
  formatUndercoverVoteOptions,
  formatUndercoverVoteStatus,
  formatPreparedEnd,
  getVoteReminderOffsets,
  getRandomUndercoverWordPair,
  shouldSendVoteEndingSoon,
  UndercoverEngine,
  UNDERCOVER_JOIN_EMOJI,
  UNDERCOVER_MIN_PLAYERS,
  type UndercoverAssignment,
  type UndercoverCurrentSpeech,
  type UndercoverGame,
  type UndercoverWordPair,
  type UndercoverWordSource,
} from '../game/undercover.js'
```

- [ ] **Step 4: Use the formatter in `buildVotePanel(...)`**

In `src/commands/undercover.ts`, replace this line inside `buildVotePanel(...)`:

```ts
    `**当前存活玩家：**\n${formatUndercoverPlayerList(candidates)}\n` +
```

with:

```ts
    `**当前存活玩家：**\n${formatUndercoverPlayerVoteList(candidates, vote?.votes ?? {})}\n` +
```

Do not change this line:

```ts
    [voteActionRow()],
```

That keeps the current buttons, including `查看历史`.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
All undercover tests pass.
```

---

## Task 3: Build Verification

**Files:**
- Verify only

- [ ] **Step 1: Run the TypeScript build**

Run:

```bash
npm run build
```

Expected:

```text
tsc completes without errors.
```

- [ ] **Step 2: Check whitespace**

Run:

```bash
git diff --check -- src/commands/undercover.ts src/game/undercover.ts src/test-undercover.ts
```

Expected:

```text
No whitespace errors.
```

- [ ] **Step 3: Review the diff**

Run:

```bash
git diff -- src/commands/undercover.ts src/game/undercover.ts src/test-undercover.ts
```

Expected:

```text
The diff only adds the public vote relationship text and tests. It does not alter vote buttons, history, close vote, participant limits, role assignment, speech, or reaction handling.
```

---

## Edge Cases

- Revote: existing `castVote(...)` overwrites `votes[voterId]`; the panel will update from `小明 -> 小红` to `小明 -> 小蓝`.
- Self-vote: if the existing UI allows it, the panel will show `小明 -> 小明`.
- Not voted: no arrow is shown.
- Invalid stored target: no arrow is shown for that voter.
- Invalid stored voter: ignored because only displayed living players are rendered.
- Eliminated players: hidden from the current living player list and therefore hidden from the voter relationship list.
- Duplicate display names: behavior matches the existing panel behavior; this change does not solve or worsen name collisions.

---

## Self-Review

- Spec coverage: The plan preserves `查看历史`, avoids reaction voting, adds public voter-to-target text, and keeps existing voting mechanics.
- Placeholder scan: No `TBD`, `TODO`, or vague implementation steps remain.
- Type consistency: `formatUndercoverPlayerVoteList(players, votes)` uses existing `DisplayNumberedPlayer[]` and `Record<string, string>`.
- Channel closure: No new Discord command, button, select menu, modal, or reaction entry point is introduced.
