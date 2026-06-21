# Undercover Skip And Multiple Undercover Implementation Plan

> **Execution:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add host-controlled speech skipping and host-selected undercover counts while keeping vote resolution limited to elimination only.

**Architecture:** Keep the existing single-channel `UndercoverEngine` as the source of truth. Extend the deal result from one undercover ID to a list of undercover IDs, add one engine state transition for skipping the current speech turn, and keep Discord button handlers as thin wrappers around engine methods.

**Tech Stack:** TypeScript, discord.js v14, existing `UndercoverEngine`, existing `src/test-undercover.ts` smoke/integration test file, `tsx`, `tsc`.

---

## Scope

### Confirmed Facts

- `src/game/undercover.ts` currently stores one undercover in `UndercoverDealResult.undercoverUserId`.
- `UndercoverEngine.dealWords(...)` currently picks one undercover, freezes registration, creates fixed player numbers, and initializes `aliveUserIds`.
- Speech is currently blocked on `currentSpeech.order[currentSpeech.currentIndex]`; only that player can submit through `submitSpeech(...)`.
- Speech history stores only submitted entries in `speech.entries`; there is no skipped-entry type.
- Voting currently eliminates the unique highest-voted player or returns a tie, then `src/commands/undercover.ts` announces a special "卧底被淘汰，平民胜利" message when the eliminated player is the single undercover.
- PostgreSQL stores `deal` as JSONB, so changing the shape of `deal` does not require a schema migration.
- User confirmed there are no old stored games to preserve, so no old `undercoverUserId` storage compatibility is required.

### Requirements

- Add a `跳过` button under the speech panel.
- Only the current game host can click `跳过`.
- `跳过` only advances the current speech turn; it does not remove the player, change alive players, change vote candidates, change identity, or write fake speech history.
- A skipped player who later submits an old modal should fail because they are no longer the current speaker.
- `/卧底 正式开始` accepts optional integer option `卧底数量`.
- The official-start button keeps the default undercover count of `1`.
- If the command option is omitted, undercover count defaults to `1`.
- Undercover count validation is only: integer, at least `1`, and less than participant count.
- Voting no longer announces or decides civilian/undercover victory. It only announces tie or who was eliminated.
- Host secret, audience peek, and end reveal show all undercovers.

### Non-Goals

- Do not add dynamic ratio rules such as "undercover must be fewer than civilians".
- Do not auto-end the game after any vote result.
- Do not add old-storage compatibility for `deal.undercoverUserId`.
- Do not expose skipped players in speech history.
- Do not let hosts skip arbitrary future players.
- Do not add a separate command for skipping speech.

---

## File Structure

- Modify: `src/game/undercover.ts`
  - Change `UndercoverDealResult` from `undercoverUserId` to `undercoverUserIds`.
  - Remove `role` from `UndercoverCloseVoteResult` in the vote-resolution task because final vote resolution no longer needs identity.
  - Add deal count validation and multi-undercover assignment.
  - Add `UndercoverEngine.skipCurrentSpeech(...)`.
  - Update secret/reveal/peek formatters to accept `undercoverNames: string[]`.
  - Keep storage schema unchanged; `deal` remains JSONB.

- Modify: `src/commands/undercover.ts`
  - Add slash option `卧底数量` to `/卧底 正式开始`.
  - Pass command-selected count to `dealAndNotify(...)`.
  - Keep official-start button path passing count `1`.
  - Add `跳过` button and route it to a new `handleSkipSpeechButton(...)`.
  - Update host/audience/end reveal display to list all undercovers.
  - Simplify vote result announcement to tie or elimination only.

- Modify: `src/test-undercover.ts`
  - Update existing single-undercover assertions to use `undercoverUserIds`.
  - Add core tests for multiple undercovers and count validation.
  - Add command tests for command-selected count and button default count.
  - Add core and button tests for host-only skip behavior.
  - Update vote tests to assert no victory wording.

---

## Task 1: Multi-Undercover Deal Model

**Files:**
- Modify: `src/game/undercover.ts`
- Modify: `src/commands/undercover.ts`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Write failing core tests for multi-undercover deal results**

In `src/test-undercover.ts`, replace the first single-undercover assertions around the initial `dealResult` with this code:

```ts
const dealResult = await UndercoverEngine.dealWords(channelId, { rng: sequenceRng([0, 0]) })

assert.deepEqual(dealResult.undercoverUserIds, ['u1'])
assert.deepEqual(
  dealResult.assignments.map(a => ({ userId: a.userId, role: a.role, word: a.word })),
  [
    { userId: 'u1', role: 'undercover', word: '梨' },
    { userId: 'u2', role: 'civilian', word: '苹果' },
    { userId: 'u3', role: 'civilian', word: '苹果' },
  ],
)
assert.equal((await UndercoverEngine.addPlayer(channelId, 'u4')).reason, 'already_dealt')
assert.equal((await UndercoverEngine.removePlayer(channelId, 'u2')).removed, false)
console.log('✅ 正式开始默认随机选出 1 名卧底、生成词语分配，并冻结报名')
```

Add this new independent-channel block immediately after the first deal/freeze assertions above and before the `const commandNames = ...` command-registration assertion:

```ts
const multiDealChannelId = 'undercover-multi-deal-channel'
await UndercoverEngine.startGame(multiDealChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '苹果',
  undercoverWord: '梨',
  allowLying: false,
})
await UndercoverEngine.addPlayer(multiDealChannelId, 'm1')
await UndercoverEngine.addPlayer(multiDealChannelId, 'm2')
await UndercoverEngine.addPlayer(multiDealChannelId, 'm3')
await UndercoverEngine.addPlayer(multiDealChannelId, 'm4')

await assert.rejects(
  () => UndercoverEngine.dealWords(multiDealChannelId, { undercoverCount: 0, rng: () => 0 }),
  /卧底数量至少为 1/,
)
await assert.rejects(
  () => UndercoverEngine.dealWords(multiDealChannelId, { undercoverCount: 4, rng: () => 0 }),
  /卧底数量必须小于参与者数量/,
)

const multiDeal = await UndercoverEngine.dealWords(multiDealChannelId, {
  undercoverCount: 2,
  rng: sequenceRng([0, 0, 0, 0, 0]),
})
assert.deepEqual(multiDeal.undercoverUserIds, ['m1', 'm2'])
assert.deepEqual(
  multiDeal.assignments.map(a => ({ userId: a.userId, role: a.role, word: a.word })),
  [
    { userId: 'm1', role: 'undercover', word: '梨' },
    { userId: 'm2', role: 'undercover', word: '梨' },
    { userId: 'm3', role: 'civilian', word: '苹果' },
    { userId: 'm4', role: 'civilian', word: '苹果' },
  ],
)
assert.deepEqual(UndercoverEngine.getGame(multiDealChannelId)?.deal?.undercoverUserIds, ['m1', 'm2'])
await UndercoverEngine.endGame(multiDealChannelId)
console.log('✅ 正式开始支持主持人指定多个卧底，并只限制卧底数量小于参与者数量')
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
TypeScript error because dealWords does not accept { undercoverCount, rng } and UndercoverDealResult has no undercoverUserIds.
```

- [ ] **Step 3: Update the deal result type**

In `src/game/undercover.ts`, replace `UndercoverDealResult` with:

```ts
export interface UndercoverDealResult {
  civilianWord: string
  undercoverWord: string
  undercoverUserIds: string[]
  assignments: UndercoverAssignment[]
}
```

Do not change `UndercoverCloseVoteResult` in this task. Its `role` field is removed in Task 3, after the vote announcement test is changed.

Add this helper type near the store interfaces:

```ts
interface DealWordsOptions {
  undercoverCount?: number
  rng?: () => number
}
```

- [ ] **Step 4: Update cloned and parsed deal state**

In `cloneGame(...)`, keep the existing `deal` branch but it will now clone the new `undercoverUserIds` array:

```ts
    deal: game.deal
      ? {
          ...game.deal,
          undercoverUserIds: [...game.deal.undercoverUserIds],
          assignments: game.deal.assignments.map(assignment => ({ ...assignment })),
        }
      : undefined,
```

Replace `parseStoredDeal(...)` with this no-old-storage-compatibility version:

```ts
function parseStoredDeal(value: unknown): UndercoverDealResult | undefined {
  const raw = parseStoredJson<any>(value, null)
  if (!raw || typeof raw !== 'object') return undefined
  if (
    typeof raw.civilianWord !== 'string' ||
    typeof raw.undercoverWord !== 'string' ||
    !Array.isArray(raw.undercoverUserIds)
  ) {
    return undefined
  }

  const undercoverUserIds = raw.undercoverUserIds
    .filter((userId: unknown): userId is string => typeof userId === 'string')

  const assignments = Array.isArray(raw.assignments)
    ? raw.assignments
        .filter((assignment: any) => (
          typeof assignment?.userId === 'string' &&
          (assignment.role === 'civilian' || assignment.role === 'undercover') &&
          typeof assignment.word === 'string'
        ))
        .map((assignment: any) => ({
          userId: assignment.userId,
          role: assignment.role,
          word: assignment.word,
        }))
    : []

  return {
    civilianWord: raw.civilianWord,
    undercoverWord: raw.undercoverWord,
    undercoverUserIds,
    assignments,
  }
}
```

- [ ] **Step 5: Add count validation and multi-undercover selection**

Replace the current `dealWords(...)` method signature and assignment block in `src/game/undercover.ts` with:

```ts
  static async dealWords(
    channelId: string,
    options: DealWordsOptions | (() => number) = {},
  ): Promise<UndercoverDealResult> {
    const normalizedOptions: DealWordsOptions = typeof options === 'function'
      ? { rng: options }
      : options
    const rng = normalizedOptions.rng ?? Math.random
    const undercoverCount = normalizedOptions.undercoverCount ?? 1

    return withChannelWrite(channelId, async () => {
      const game = this.requireGame(channelId)
      if (game.dealtAt) {
        throw new Error('本局已经发过词了。')
      }
      if (game.players.length < UNDERCOVER_MIN_PLAYERS) {
        throw new Error(`至少需要 ${UNDERCOVER_MIN_PLAYERS} 名玩家才能发词。`)
      }
      if (!Number.isInteger(undercoverCount) || undercoverCount < 1) {
        throw new Error('卧底数量至少为 1。')
      }
      if (undercoverCount >= game.players.length) {
        throw new Error(`卧底数量必须小于参与者数量。当前玩家数：${game.players.length}`)
      }

      const availableUserIds = game.players.map(player => player.userId)
      const undercoverUserIds: string[] = []
      for (let count = 0; count < undercoverCount; count += 1) {
        const undercoverIndex = Math.min(
          availableUserIds.length - 1,
          Math.floor(rng() * availableUserIds.length),
        )
        const [undercoverUserId] = availableUserIds.splice(undercoverIndex, 1)
        undercoverUserIds.push(undercoverUserId)
      }
      const undercoverUserIdSet = new Set(undercoverUserIds)

      const result: UndercoverDealResult = {
        civilianWord: game.civilianWord,
        undercoverWord: game.undercoverWord,
        undercoverUserIds,
        assignments: game.players.map(player => {
          const isUndercover = undercoverUserIdSet.has(player.userId)
          return {
            userId: player.userId,
            role: isUndercover ? 'undercover' : 'civilian',
            word: isUndercover ? game.undercoverWord : game.civilianWord,
          }
        }),
      }
```

Leave the existing rollback, fixed-player, alive-player, save, and return code after this block unchanged except for using the new `result`.

- [ ] **Step 6: Update existing singular deal call sites**

This task changes the deal shape, so update all existing runtime and test call sites before trying to pass the test suite.

In `src/game/undercover.ts`, replace the temporary role calculation in `closeVote(...)`:

```ts
        const role = game.deal?.undercoverUserId === eliminatedUserId ? 'undercover' : 'civilian'
```

with:

```ts
        const role = game.deal?.undercoverUserIds.includes(eliminatedUserId) ? 'undercover' : 'civilian'
```

This keeps the old victory announcement behavior working until Task 3 removes it.

In `src/commands/undercover.ts`, replace the single-name lookup in `handleAudiencePeek(...)`:

```ts
  const undercoverName = await resolveDisplayName(interaction, game.deal.undercoverUserId)
```

with:

```ts
  const undercoverUserId = game.deal.undercoverUserIds[0]
  const undercoverName = undercoverUserId
    ? await resolveDisplayName(interaction, undercoverUserId)
    : '未知玩家'
```

In `buildEndContent(...)`, replace:

```ts
  const undercoverName = await resolveDisplayName(interaction, game.deal.undercoverUserId)
```

with:

```ts
  const undercoverUserId = game.deal.undercoverUserIds[0]
  const undercoverName = undercoverUserId
    ? await resolveDisplayName(interaction, undercoverUserId)
    : '未知玩家'
```

In `dealAndNotify(...)`, replace:

```ts
  const undercoverName = displayPlayers.find(player => player.userId === result.undercoverUserId)?.displayName
    ?? '未知玩家'
```

with:

```ts
  const undercoverName = displayPlayers.find(player => player.userId === result.undercoverUserIds[0])?.displayName
    ?? '未知玩家'
```

In `src/test-undercover.ts`, replace the reload persistence assertions:

```ts
const reloadDeal = await UndercoverEngine.dealWords(reloadChannelId, () => 0)
assert.equal(reloadDeal.undercoverUserId, 'r1')
```

with:

```ts
const reloadDeal = await UndercoverEngine.dealWords(reloadChannelId, { rng: () => 0 })
assert.deepEqual(reloadDeal.undercoverUserIds, ['r1'])
```

Replace:

```ts
assert.equal(reloadedGame?.deal?.undercoverUserId, 'r1')
```

with:

```ts
assert.deepEqual(reloadedGame?.deal?.undercoverUserIds, ['r1'])
```

- [ ] **Step 7: Run test to verify it passes this task**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
🎉 谁是卧底核心逻辑测试全部通过！
```

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add src/game/undercover.ts src/commands/undercover.ts src/test-undercover.ts
git commit -m "feat: support multiple undercover assignments"
```

Expected:

```text
Commit succeeds after the task tests pass.
```

---

## Task 2: Command Option And Multi-Undercover Display

**Files:**
- Modify: `src/commands/undercover.ts`
- Modify: `src/game/undercover.ts`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Write failing display and command tests**

In `src/test-undercover.ts`, update the command list assertion to keep the same subcommands and add option-level checks for `正式开始`:

```ts
const commandJson = undercoverCommandData.toJSON()
const commandNames = commandJson.options?.map((option: any) => option.name)
assert.deepEqual(
  commandNames,
  ['报名阶段', '正式开始', '开始发言', '投票', '游戏通知', '观众偷看', '结束', '帮助'],
)
const officialStartCommand = commandJson.options?.find((option: any) => option.name === '正式开始') as any
assert.equal(
  officialStartCommand.options.some((option: any) => option.name === '卧底数量' && option.min_value === 1),
  true,
)
console.log('✅ 谁是卧底保留原命令并注册开始发言、投票和卧底数量选项')
```

Replace formatter tests for host secret, end reveal, and audience peek with:

```ts
const hostSecret = formatHostSecret({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverNames: ['用户A', '用户B'],
  allowLying: true,
  failedDmNames: ['用户C'],
})

assert.equal(
  hostSecret,
  '## 本局词语\n\n**平民词：**苹果\n**卧底词：**梨\n**可否撒谎：**是\n\n**卧底：**用户A、用户B\n\n**私信失败：**用户C',
)
console.log('✅ 主持人秘密信息包含词语、所有卧底、撒谎规则和私信失败提示')

const endReveal = formatEndReveal({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverNames: ['用户A', '用户B'],
})

assert.equal(
  endReveal,
  '## 🏁 谁是卧底结束\n\n**平民词：**苹果\n**卧底词：**梨\n\n**卧底：**用户A、用户B',
)
console.log('✅ 正式开始后结束公开信息包含平民词、卧底词和所有卧底')

const audiencePeek = formatAudiencePeek({
  civilianWord: '苹果',
  undercoverWord: '梨',
  undercoverNames: ['用户A', '用户B'],
})

assert.equal(
  audiencePeek,
  '## 👀 观众偷看\n\n**平民词：**苹果\n**卧底词：**梨\n\n**卧底：**用户A、用户B\n\n请不要泄露词汇和卧底身份。',
)
console.log('✅ 观众偷看信息包含平民词、卧底词、所有卧底和保密提醒')
```

In the official command start test, change the fake option object to:

```ts
  options: {
    getSubcommand: () => '正式开始',
    getInteger: (name: string) => name === '卧底数量' ? 2 : null,
  },
```

Add one more player to that official command test before executing the command:

```ts
await UndercoverEngine.addPlayer(officialPanelChannelId, 'p4')
```

Replace the test RNG setup:

```ts
Math.random = sequenceRng([0, 0, 0])
```

with:

```ts
Math.random = sequenceRng([0, 0, 0, 0, 0])
```

The first two RNG values select `p1` and `p2` as undercovers. The remaining three values produce the fixed display order `p2, p3, p4, p1`.

Update the public speech-order assertion in the same test from:

```ts
assert.equal(officialPublicText.includes('**1.** 玩家p2\n**2.** 玩家p3\n**3.** 玩家p1'), true)
```

to:

```ts
assert.equal(officialPublicText.includes('**1.** 玩家p2\n**2.** 玩家p3\n**3.** 玩家p4\n**4.** 玩家p1'), true)
```

Update its host-secret assertion:

```ts
assert.equal(getPanelText(officialSecretReply).includes('**卧底：**玩家p1、玩家p2'), true)
```

Keep the official-start button test at three players and update its assertion to prove button default is still one undercover:

```ts
assert.equal(getPanelText(officialButtonFollowUp).includes('**卧底：**按钮玩家b1'), true)
assert.equal(getPanelText(officialButtonFollowUp).includes('按钮玩家b2'), false)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
TypeScript errors or AssertionError because slash option 卧底数量 and multi-name formatter inputs are not implemented.
```

- [ ] **Step 3: Add the slash option constant and command option**

In `src/commands/undercover.ts`, add the option constant near the existing option constants:

```ts
const UNDERCOVER_COUNT_OPTION = '卧底数量'
```

Replace the `正式开始` subcommand definition with:

```ts
  .addSubcommand(sub => sub
    .setName('正式开始')
    .setDescription('停止报名，BOT将词汇私信给参与者')
    .addIntegerOption(option => option
      .setName(UNDERCOVER_COUNT_OPTION)
      .setDescription('可选卧底数量，不填默认 1；按钮正式开始固定为 1')
      .setRequired(false)
      .setMinValue(1)
    )
  )
```

- [ ] **Step 4: Update formatters to accept all undercover names**

In `src/game/undercover.ts`, add this helper near `formatBooleanRule(...)` and `formatWordSource(...)`:

```ts
function formatUndercoverNames(names: string[]): string {
  return names.map(formatDiscordDisplayName).join('、')
}
```

Replace `formatHostSecret(...)`, `formatEndReveal(...)`, and `formatAudiencePeek(...)` with:

```ts
export function formatHostSecret(input: {
  civilianWord: string
  undercoverWord: string
  undercoverNames: string[]
  allowLying: boolean
  failedDmNames?: string[]
}): string {
  let content =
    `## 本局词语\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}\n` +
    `**可否撒谎：**${formatBooleanRule(input.allowLying)}\n\n` +
    `**卧底：**${formatUndercoverNames(input.undercoverNames)}`

  if (input.failedDmNames && input.failedDmNames.length > 0) {
    content += `\n\n**私信失败：**${input.failedDmNames.map(formatDiscordDisplayName).join('、')}`
  }

  return content
}

export function formatEndReveal(input: {
  civilianWord: string
  undercoverWord: string
  undercoverNames: string[]
}): string {
  return (
    `## 🏁 谁是卧底结束\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}\n\n` +
    `**卧底：**${formatUndercoverNames(input.undercoverNames)}`
  )
}

export function formatAudiencePeek(input: {
  civilianWord: string
  undercoverWord: string
  undercoverNames: string[]
}): string {
  return (
    `## 👀 观众偷看\n\n` +
    `**平民词：**${input.civilianWord}\n` +
    `**卧底词：**${input.undercoverWord}\n\n` +
    `**卧底：**${formatUndercoverNames(input.undercoverNames)}\n\n` +
    `请不要泄露词汇和卧底身份。`
  )
}
```

- [ ] **Step 5: Pass the selected undercover count through official start**

In `handleOfficialStart(...)`, replace:

```ts
  await interaction.deferReply({ ephemeral: true })
  await dealAndNotify(interaction)
```

with:

```ts
  const undercoverCount = interaction.options.getInteger(UNDERCOVER_COUNT_OPTION) ?? 1
  await interaction.deferReply({ ephemeral: true })
  await dealAndNotify(interaction, undercoverCount)
```

In `handleOfficialStartButton(...)`, replace:

```ts
  await interaction.deferReply({ ephemeral: true })
  await dealAndNotify(interaction)
```

with:

```ts
  await interaction.deferReply({ ephemeral: true })
  await dealAndNotify(interaction, 1)
```

Change the `dealAndNotify(...)` signature:

```ts
async function dealAndNotify(interaction: UndercoverInteraction, undercoverCount: number) {
```

Inside `dealAndNotify(...)`, replace:

```ts
    result = await UndercoverEngine.dealWords(channelId)
```

with:

```ts
    result = await UndercoverEngine.dealWords(channelId, { undercoverCount })
```

- [ ] **Step 6: Update reveal display call sites**

In `dealAndNotify(...)`, replace the single-name lookup:

```ts
  const undercoverName = displayPlayers.find(player => player.userId === result.undercoverUserId)?.displayName
    ?? '未知玩家'
```

with:

```ts
  const displayNameByUserId = new Map(displayPlayers.map(player => [player.userId, player.displayName]))
  const undercoverNames = result.undercoverUserIds.map(userId => displayNameByUserId.get(userId) ?? '未知玩家')
```

Then replace the whole host-secret call:

```ts
  await sendHostSecretWithFallback(interaction, game, formatHostSecret({
    civilianWord: result.civilianWord,
    undercoverWord: result.undercoverWord,
    undercoverNames,
    allowLying: game.allowLying,
    failedDmNames,
  }))
```

In `buildEndContent(...)`, replace the single-name lookup and formatter call with:

```ts
  const undercoverNames = await Promise.all(
    game.deal.undercoverUserIds.map(userId => resolveDisplayName(interaction, userId)),
  )
  return formatEndReveal({
    civilianWord: game.deal.civilianWord,
    undercoverWord: game.deal.undercoverWord,
    undercoverNames,
  })
```

In `handleAudiencePeek(...)`, replace the single-name lookup and formatter call with:

```ts
  const undercoverNames = await Promise.all(
    game.deal.undercoverUserIds.map(userId => resolveDisplayName(interaction, userId)),
  )
  await interaction.editReply(panel(formatAudiencePeek({
    civilianWord: game.deal.civilianWord,
    undercoverWord: game.deal.undercoverWord,
    undercoverNames,
  })))
```

- [ ] **Step 7: Update help text**

In `handleHelp(...)`, replace:

```ts
多数玩家会拿到同一个平民词，只有 1 名玩家拿到不同但相近的卧底词。
```

with:

```ts
多数玩家会拿到同一个平民词，一名或多名玩家会拿到不同但相近的卧底词。
```

Replace the `正式开始` command help text:

```ts
停止报名，Bot 将词汇私信给参与者，并公布固定发言顺序。仅本局主持人可用。
```

with:

```ts
停止报名，Bot 将词汇私信给参与者，并公布固定发言顺序；可选卧底数量，不填默认 1。仅本局主持人可用。
```

- [ ] **Step 8: Run test to verify it passes this task**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
🎉 谁是卧底核心逻辑测试全部通过！
```

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src/commands/undercover.ts src/game/undercover.ts src/test-undercover.ts
git commit -m "feat: expose undercover count in official start"
```

Expected:

```text
Commit succeeds after the task tests pass.
```

---

## Task 3: Vote Resolution Announces Elimination Only

**Files:**
- Modify: `src/game/undercover.ts`
- Modify: `src/commands/undercover.ts`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Write failing vote-result tests**

In `src/test-undercover.ts`, replace the "undercover eliminated" assertions with:

```ts
assert.equal(closedVotePanelEdited, true)
assert.equal(UndercoverEngine.hasActiveGame(undercoverEliminatedChannelId), true)
assert.equal(UndercoverEngine.getGame(undercoverEliminatedChannelId)?.currentVote, undefined)
assert.deepEqual(UndercoverEngine.getGame(undercoverEliminatedChannelId)?.aliveUserIds, ['e2', 'e3'])
assert.equal(getPanelText(undercoverResultPanel).includes('玩家e1'), true)
assert.equal(getPanelText(undercoverResultPanel).includes('遗憾出局'), true)
assert.equal(getPanelText(undercoverResultPanel).includes('卧底被淘汰，平民胜利'), false)
assert.equal(getPanelText(undercoverResultPanel).includes('游戏结束'), false)
await UndercoverEngine.endGame(undercoverEliminatedChannelId)
console.log('✅ 投票只宣布被淘汰玩家，不判断卧底或平民胜利')
```

In the earlier direct `closeVote(...)` assertions, remove any assertion that depends on `result.role`. Keep:

```ts
assert.equal(voteClose.result?.type, 'eliminated')
assert.equal(voteClose.result?.eliminatedUserId, 'u2')
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
AssertionError because announceVoteResult still sends 卧底被淘汰，平民胜利.
```

- [ ] **Step 3: Remove role calculation from closeVote**

In `src/game/undercover.ts`, replace the eliminated branch in `closeVote(...)`:

```ts
        const eliminatedUserId = topUserIds[0]
        const role = game.deal?.undercoverUserId === eliminatedUserId ? 'undercover' : 'civilian'
        game.aliveUserIds = previousAliveUserIds.filter(userId => userId !== eliminatedUserId)
        game.eliminatedUserIds = [...previousEliminatedUserIds, eliminatedUserId]
        result = {
          type: 'eliminated',
          eliminatedUserId,
          role,
          votes: counts,
        }
```

with:

```ts
        const eliminatedUserId = topUserIds[0]
        game.aliveUserIds = previousAliveUserIds.filter(userId => userId !== eliminatedUserId)
        game.eliminatedUserIds = [...previousEliminatedUserIds, eliminatedUserId]
        result = {
          type: 'eliminated',
          eliminatedUserId,
          votes: counts,
        }
```

- [ ] **Step 4: Simplify vote result announcement**

In `src/commands/undercover.ts`, replace the eliminated branch in `announceVoteResult(...)`:

```ts
  const eliminated = (await getDisplayNumberedPlayers(interaction, gameBeforeClose, [result.eliminatedUserId]))[0]
  const label = eliminated ? formatDiscordDisplayName(eliminated.displayName) : `<@${result.eliminatedUserId}>`
  if (result.role === 'undercover') {
    await channel.send(panel(
      `## 🏁 投票结果\n\n` +
      `**${label}** 遗憾出局。\n\n卧底被淘汰，平民胜利。`,
    ))
    return
  }

  await channel.send(panel(
    `## 🗳️ 投票结果\n\n` +
    `**${label}** 遗憾出局。`,
  ))
```

with:

```ts
  const eliminated = (await getDisplayNumberedPlayers(interaction, gameBeforeClose, [result.eliminatedUserId]))[0]
  const label = eliminated ? formatDiscordDisplayName(eliminated.displayName) : `<@${result.eliminatedUserId}>`
  await channel.send(panel(
    `## 🗳️ 投票结果\n\n` +
    `**${label}** 遗憾出局。`,
  ))
```

- [ ] **Step 5: Update help wording for voting**

In `handleHelp(...)`, replace:

```ts
讨论结束后，由大家自行投票或由主持人组织判断。游戏结束时，Bot 会公布平民词、卧底词和卧底是谁。
```

with:

```ts
讨论结束后，由大家投票或由主持人组织判断；Bot 只负责记录淘汰结果，胜负由主持人宣布。游戏结束时，Bot 会公布平民词、卧底词和卧底是谁。
```

- [ ] **Step 6: Run test to verify it passes this task**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
Vote result tests pass and no test expects victory wording.
```

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/game/undercover.ts src/commands/undercover.ts src/test-undercover.ts
git commit -m "feat: announce vote eliminations only"
```

Expected:

```text
Commit succeeds after tests pass for this task.
```

---

## Task 4: Core Speech Skip State Transition

**Files:**
- Modify: `src/game/undercover.ts`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Write failing core skip tests**

In `src/test-undercover.ts`, add this block after the existing first full speech round test and before the first vote test:

```ts
const skipSpeechStart = await UndercoverEngine.startSpeechRound(channelId, () => 0)
assert.equal(skipSpeechStart.ok, true)
assert.deepEqual(skipSpeechStart.speech?.order, ['u2', 'u3', 'u1'])
assert.deepEqual(await UndercoverEngine.skipCurrentSpeech(channelId, 'not-host'), {
  ok: false,
  error: '只有本局主持人可以跳过发言。',
})

const skipFirst = await UndercoverEngine.skipCurrentSpeech(channelId, hostId)
assert.deepEqual(skipFirst, {
  ok: true,
  completed: false,
  round: 2,
  skippedUserId: 'u2',
  currentUserId: 'u3',
})
assert.equal((await UndercoverEngine.submitSpeech(channelId, 'u2', '旧弹窗提交')).ok, false)
assert.deepEqual(await UndercoverEngine.submitSpeech(channelId, 'u3', '跳过后正常发言'), {
  ok: true,
  completed: false,
  round: 2,
  currentUserId: 'u1',
})
const skipLast = await UndercoverEngine.skipCurrentSpeech(channelId, hostId)
assert.deepEqual(skipLast, {
  ok: true,
  completed: true,
  round: 2,
  skippedUserId: 'u1',
})
const afterSkipSpeech = UndercoverEngine.getGame(channelId)
assert.equal(afterSkipSpeech?.currentSpeech, undefined)
assert.deepEqual(afterSkipSpeech?.aliveUserIds, ['u2', 'u3', 'u1'])
assert.deepEqual(
  afterSkipSpeech?.speechRounds?.[1].entries.map(entry => ({ userId: entry.userId, content: entry.content })),
  [{ userId: 'u3', content: '跳过后正常发言' }],
)
console.log('✅ 主持人可以跳过当前发言人，跳过不写入历史且不影响存活玩家')
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
TypeScript error because UndercoverEngine.skipCurrentSpeech is not defined.
```

- [ ] **Step 3: Add the skip method**

In `src/game/undercover.ts`, add this method immediately after `submitSpeech(...)`:

```ts
  static async skipCurrentSpeech(
    channelId: string,
    hostId: string,
  ): Promise<{
    ok: boolean
    completed?: boolean
    round?: number
    skippedUserId?: string
    currentUserId?: string
    error?: string
  }> {
    return withChannelWrite(channelId, async () => {
      const game = normalizeGame(this.requireGame(channelId))
      if (game.hostId !== hostId) {
        return { ok: false, error: '只有本局主持人可以跳过发言。' }
      }

      const speech = game.currentSpeech
      if (!speech) return { ok: false, error: '当前没有进行中的发言轮。' }

      const skippedUserId = speech.order[speech.currentIndex]
      if (!skippedUserId) return { ok: false, error: '当前没有可跳过的发言玩家。' }

      const previousSpeech = cloneCurrentSpeech(speech)
      const previousRounds = game.speechRounds?.map(cloneSpeechRound) ?? []
      speech.currentIndex += 1

      let result: {
        ok: boolean
        completed: boolean
        round: number
        skippedUserId: string
        currentUserId?: string
      }

      if (speech.currentIndex >= speech.order.length) {
        const round: UndercoverSpeechRound = {
          round: speech.round,
          order: [...speech.order],
          entries: speech.entries.map(entry => ({ ...entry })),
          completedAt: Date.now(),
        }
        game.speechRounds = [...previousRounds, round]
        game.currentSpeech = undefined
        result = { ok: true, completed: true, round: round.round, skippedUserId }
      } else {
        game.currentSpeech = speech
        result = {
          ok: true,
          completed: false,
          round: speech.round,
          skippedUserId,
          currentUserId: speech.order[speech.currentIndex],
        }
      }

      games.set(channelId, game)
      try {
        await store.saveGame(game)
      } catch (error) {
        game.currentSpeech = previousSpeech
        game.speechRounds = previousRounds
        games.set(channelId, game)
        throw error
      }

      return result
    })
  }
```

- [ ] **Step 4: Run test to verify it passes this task**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
The new core skip test passes. UI button tests are not present yet.
```

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/game/undercover.ts src/test-undercover.ts
git commit -m "feat: add host speech skip state transition"
```

Expected:

```text
Commit succeeds after tests pass for this task.
```

---

## Task 5: Speech Skip Button And History Display

**Files:**
- Modify: `src/commands/undercover.ts`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Write failing button and history tests**

In the existing speech panel test in `src/test-undercover.ts`, replace:

```ts
assert.deepEqual(speechPanelButtons, ['发言', '查看历史'])
```

with:

```ts
assert.deepEqual(speechPanelButtons, ['发言', '查看历史', '跳过'])
```

Add this new integration block after the existing speech panel/history tests:

```ts
const skipButtonChannelId = 'undercover-skip-button-channel'
await UndercoverEngine.startGame(skipButtonChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '白天',
  undercoverWord: '黑夜',
  allowLying: false,
})
await UndercoverEngine.addPlayer(skipButtonChannelId, 'k1')
await UndercoverEngine.addPlayer(skipButtonChannelId, 'k2')
await UndercoverEngine.addPlayer(skipButtonChannelId, 'k3')
await UndercoverEngine.dealWords(skipButtonChannelId, { rng: sequenceRng([0, 0, 0]) })
await UndercoverEngine.startSpeechRound(skipButtonChannelId)
await UndercoverEngine.setSpeechMessage(skipButtonChannelId, 'skip-old-panel')

let nonHostSkipReply: any
await handleUndercoverButton({
  customId: 'undercover_speech_skip',
  channelId: skipButtonChannelId,
  user: { id: 'not-host' },
  reply: async (payload: any) => {
    nonHostSkipReply = payload
  },
} as any)
assert.equal(nonHostSkipReply.ephemeral, true)
assert.equal(nonHostSkipReply.content.includes('只有本局主持人可以跳过发言'), true)

let oldSpeechPanelDeleted = false
let skipDeferred = false
let skipFollowUp: any
let skipNextPanel: any
await handleUndercoverButton({
  customId: 'undercover_speech_skip',
  channelId: skipButtonChannelId,
  user: { id: hostId },
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `跳过玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `跳过玩家${userId}`, username: userId }),
    },
  },
  channel: {
    messages: {
      fetch: async (messageId: string) => {
        assert.equal(messageId, 'skip-old-panel')
        return {
          delete: async () => {
            oldSpeechPanelDeleted = true
          },
        }
      },
    },
    send: async (payload: any) => {
      skipNextPanel = payload
      return { id: 'skip-next-panel' }
    },
  },
  deferUpdate: async () => {
    skipDeferred = true
  },
  followUp: async (payload: any) => {
    skipFollowUp = payload
  },
} as any)
assert.equal(skipDeferred, true)
assert.equal(oldSpeechPanelDeleted, true)
assert.equal(skipFollowUp.ephemeral, true)
assert.equal(skipFollowUp.content.includes('已跳过'), true)
assert.equal(getPanelText(skipNextPanel).includes('当前发言：<@k3>'), true)
assert.deepEqual(UndercoverEngine.getGame(skipButtonChannelId)?.currentSpeech?.entries, [])

await UndercoverEngine.skipCurrentSpeech(skipButtonChannelId, hostId)
const lastSkipResult = await UndercoverEngine.skipCurrentSpeech(skipButtonChannelId, hostId)
assert.equal(lastSkipResult.completed, true)
const skipOnlyHistory = await buildHistoryPayloadForTest(skipButtonChannelId, hostId)
assert.equal(getPanelText(skipOnlyHistory).includes('暂无发言。'), true)
assert.equal(getPanelText(skipOnlyHistory).includes('跳过玩家k1：'), false)
await UndercoverEngine.endGame(skipButtonChannelId)
console.log('✅ 发言面板提供主持人跳过按钮，跳过不写入发言历史')
```

Add this helper near the other test helpers in `src/test-undercover.ts`:

```ts
async function buildHistoryPayloadForTest(channelId: string, userId: string): Promise<any> {
  let payload: any
  await handleUndercoverButton({
    customId: 'undercover_history_open',
    channelId,
    user: { id: userId },
    guild: {
      members: {
        fetch: async (targetUserId: string) => ({ displayName: `跳过玩家${targetUserId}` }),
      },
    },
    client: {
      users: {
        fetch: async (targetUserId: string) => ({ displayName: `跳过玩家${targetUserId}`, username: targetUserId }),
      },
    },
    deferReply: async () => undefined,
    editReply: async (nextPayload: any) => {
      payload = nextPayload
    },
  } as any)
  return payload
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
AssertionError because the speech panel has no 跳过 button, or no handler responds to undercover_speech_skip.
```

- [ ] **Step 3: Add the skip button constant and row entry**

In `src/commands/undercover.ts`, add:

```ts
const UNDERCOVER_SKIP_SPEECH_BUTTON_ID = 'undercover_speech_skip'
```

Place it next to `UNDERCOVER_SPEECH_BUTTON_ID`.

Replace `speechButtonRow()` with:

```ts
function speechButtonRow() {
  return {
    type: 1,
    components: [
      { type: 2, style: 1, label: '发言', custom_id: UNDERCOVER_SPEECH_BUTTON_ID },
      { type: 2, style: 2, label: '查看历史', custom_id: UNDERCOVER_HISTORY_BUTTON_ID },
      { type: 2, style: 2, label: '跳过', custom_id: UNDERCOVER_SKIP_SPEECH_BUTTON_ID },
    ],
  }
}
```

- [ ] **Step 4: Route the button**

In `handleUndercoverButton(...)`, add this branch after the speech submit branch:

```ts
  if (interaction.customId === UNDERCOVER_SKIP_SPEECH_BUTTON_ID) {
    await handleSkipSpeechButton(interaction)
    return
  }
```

- [ ] **Step 5: Add the skip button handler**

Add this function after `handleSpeechButton(...)`:

```ts
async function handleSkipSpeechButton(interaction: ButtonInteraction) {
  const channelId = interaction.channelId
  const beforeGame = UndercoverEngine.getGame(channelId)
  if (!beforeGame?.currentSpeech) {
    await interaction.reply({ content: '❌ 当前没有进行中的发言轮。', ephemeral: true })
    return
  }

  if (beforeGame.hostId !== interaction.user.id) {
    await interaction.reply({ content: '❌ 只有本局主持人可以跳过发言。', ephemeral: true })
    return
  }

  const previousMessageId = beforeGame.currentSpeech.messageId
  await interaction.deferUpdate()
  const result = await UndercoverEngine.skipCurrentSpeech(channelId, interaction.user.id)
  if (!result.ok) {
    await interaction.followUp({ content: `❌ ${result.error ?? '跳过发言失败。'}`, ephemeral: true })
    return
  }

  await deleteChannelMessage(interaction, previousMessageId)

  if (result.completed) {
    const channel = interaction.channel
    const game = UndercoverEngine.getGame(channelId)
    const round = game?.speechRounds?.find(item => item.round === result.round)
    if (channel && 'send' in channel && game && round) {
      await channel.send(await buildCompletedSpeechPanel(interaction, game, round))
    }
    await interaction.followUp({ content: '✅ 已跳过当前发言人，本轮发言已结束。', ephemeral: true })
    return
  }

  const game = UndercoverEngine.getGame(channelId)
  if (game?.currentSpeech) {
    await sendSpeechPanel(interaction, game.currentSpeech, 'send')
  }
  await interaction.followUp({ content: '✅ 已跳过当前发言人，已轮到下一位玩家。', ephemeral: true })
}
```

- [ ] **Step 6: Keep empty skipped rounds readable without fake entries**

In `src/commands/undercover.ts`, add this helper after `formatSpeechEntriesForPanel(...)`:

```ts
function formatCompletedSpeechEntriesForPanel(
  entries: UndercoverCurrentSpeech['entries'],
  playersByUserId: Map<string, { number: number; displayName: string }>,
): string {
  const formatted = formatSpeechEntriesForPanel(entries, playersByUserId)
  return formatted || '暂无发言。'
}
```

In `buildCompletedSpeechPanel(...)`, replace:

```ts
  const entries = formatSpeechEntriesForPanel(round.entries, byUserId)
```

with:

```ts
  const entries = formatCompletedSpeechEntriesForPanel(round.entries, byUserId)
```

In `buildHistoryPanel(...)`, replace:

```ts
  const lines = round.entries.map(entry => {
    const player = byUserId.get(entry.userId)
    const label = player
      ? `${player.number}. ${formatDiscordDisplayName(player.displayName)}`
      : `<@${entry.userId}>`
    return `**${label}：**${escapeDiscordMarkdownText(entry.content)}`
  })
```

with:

```ts
  const entries = formatCompletedSpeechEntriesForPanel(round.entries, byUserId)
```

Then replace:

```ts
    `## 📜 发言历史 (${safePage}/${total})\n\n${lines.join('\n')}`,
```

with:

```ts
    `## 📜 发言历史 (${safePage}/${total})\n\n${entries}`,
```

- [ ] **Step 7: Run test to verify it passes this task**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
Speech panel includes 发言、查看历史、跳过. Host skip advances the panel. History shows 暂无发言。 for a round where every player was skipped and does not show skipped-player fake speech.
```

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/commands/undercover.ts src/test-undercover.ts
git commit -m "feat: add host speech skip button"
```

Expected:

```text
Commit succeeds after tests pass for this task.
```

---

## Task 6: Persistence And Build Verification

**Files:**
- Modify: `src/test-undercover.ts`
- Verify: `src/game/undercover.ts`
- Verify: `src/commands/undercover.ts`

- [ ] **Step 1: Verify the old singular deal field is gone**

The valid new field is `undercoverUserIds`, so search for the exact old singular identifier only:

```bash
rg -n '\bundercoverUserId\b' src
```

Expected after edits:

```text
No results.
```

- [ ] **Step 2: Run the full undercover test**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected:

```text
🎉 谁是卧底核心逻辑测试全部通过！
```

- [ ] **Step 3: Run TypeScript build**

Run:

```bash
npm run build
```

Expected:

```text
tsc completes without errors.
```

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check -- src/game/undercover.ts src/commands/undercover.ts src/test-undercover.ts
```

Expected:

```text
No output.
```

- [ ] **Step 5: Review diff for scope**

Run:

```bash
git diff -- src/game/undercover.ts src/commands/undercover.ts src/test-undercover.ts
```

Expected:

```text
The diff only changes undercover count assignment/display, vote elimination wording, speech skip state, speech skip button wiring, and tests.
```

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add src/game/undercover.ts src/commands/undercover.ts src/test-undercover.ts
git commit -m "test: verify undercover skip and multi-undercover flow"
```

Expected:

```text
Commit succeeds.
```

---

## Runtime Check

After deployment or local bot startup, verify these Discord flows manually because they depend on Discord interactions:

- Start a lobby, join at least three players, click the `正式开始` button, and confirm the host secret shows exactly one undercover.
- Start a lobby, run `/卧底 正式开始 卧底数量:2`, and confirm two players receive the undercover word and the host secret lists two names.
- Try `/卧底 正式开始 卧底数量:<参与者人数>` and confirm the host receives `卧底数量必须小于参与者数量`.
- Start a speech round, click `跳过` as a non-host, and confirm it is rejected privately.
- Start a speech round, click `跳过` as host, and confirm the panel advances to the next current speaker.
- Open history after skipped turns and confirm skipped players are not listed as if they spoke.
- Run a vote that eliminates an undercover and confirm Bot only says that player is out, with no victory announcement.

---

## Self-Review

- Spec coverage: The plan covers host-only skip button, skip-only state transition, no fake skipped history entries, configurable undercover count through command, button default count of one, loose count validation, all-undercover display, vote elimination-only behavior, no old-storage compatibility, and no automatic victory logic.
- Placeholder scan: No placeholder markers, deferred-work wording, or undefined later function remains.
- Type consistency: The plan consistently uses `undercoverUserIds: string[]`, `undercoverNames: string[]`, `DealWordsOptions`, and `skipCurrentSpeech(...)`.
- Channel closure: New button ID `undercover_speech_skip` has a branch in `handleUndercoverButton(...)` and a concrete handler `handleSkipSpeechButton(...)`. New slash option `卧底数量` is registered and read in `handleOfficialStart(...)`.
