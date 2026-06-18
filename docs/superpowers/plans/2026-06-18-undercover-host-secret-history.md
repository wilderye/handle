# Undercover Host Secret And History Reliability Implementation Plan

> **Execution:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the host can recover the undercover identity when the start-button private reply fails, allow the host to use the peek command, and prevent history-button interactions from hanging.

**Architecture:** Keep the game state flow unchanged: starting the game still deals words and sends the public start panel once. Add a focused host-secret delivery helper around the final private host response, and change the history button to acknowledge the Discord interaction before doing slower nickname/history work.

**Tech Stack:** TypeScript, discord.js v14, existing `src/test-undercover.ts` script, `npm run build`, `npx tsx src/test-undercover.ts`.

---

## File Structure

- Modify `src/commands/undercover.ts`
  - `dealAndNotify(...)`: replace the single host `editReply(...)` call with a host-secret delivery helper.
  - `handleAudiencePeek(...)`: allow the host to use the command after words have been dealt.
  - `handleHistoryButton(...)`: defer/acknowledge first, then build and edit the history reply.
  - Add small helper functions near `dealAndNotify(...)` for host-secret fallback and recovery message delivery.
- Modify `src/test-undercover.ts`
  - Add button-start coverage for host-secret fallback.
  - Update host peek expectations.
  - Update history-button expectations to verify the interaction is acknowledged before history content is edited.

---

### Task 1: Add Failing Tests For Start-Button Host Secret Fallback

**Files:**
- Modify: `src/test-undercover.ts:358-423`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Add a button-start fallback test after the existing slash-command official-start test**

Insert this block after the existing assertions for `officialSecretReply` and before `await UndercoverEngine.endGame(officialPanelChannelId)`:

```ts
assert.equal(getPanelText(officialSecretReply).includes('**卧底：**玩家p1'), true)

const officialButtonFallbackChannelId = 'undercover-official-button-fallback-channel'
await UndercoverEngine.startGame(officialButtonFallbackChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '咖啡',
  undercoverWord: '奶茶',
  allowLying: false,
})
await UndercoverEngine.addPlayer(officialButtonFallbackChannelId, 'b1')
await UndercoverEngine.addPlayer(officialButtonFallbackChannelId, 'b2')
await UndercoverEngine.addPlayer(officialButtonFallbackChannelId, 'b3')
let officialButtonDeferred = false
let officialButtonFollowUp: any
let officialButtonPublicPanel: any
Math.random = sequenceRng([0, 0, 0])
await handleUndercoverButton({
  customId: 'undercover_official_start',
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `按钮玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({
        displayName: `按钮玩家${userId}`,
        username: userId,
        send: async () => undefined,
      }),
    },
  },
  channelId: officialButtonFallbackChannelId,
  channel: {
    send: async (payload: any) => {
      officialButtonPublicPanel = payload
    },
  },
  user: { id: hostId },
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
    officialButtonDeferred = true
  },
  editReply: async () => {
    throw new Error('模拟按钮路径主持人私密面板展示失败')
  },
  followUp: async (payload: any) => {
    officialButtonFollowUp = payload
  },
} as any)
Math.random = originalRandom
assert.equal(officialButtonDeferred, true)
assert.equal(getPanelText(officialButtonPublicPanel).includes('**发言顺序：**'), true)
assert.equal(officialButtonFollowUp.ephemeral, true)
assert.equal(getPanelText(officialButtonFollowUp).includes('**卧底：**按钮玩家b1'), true)
await UndercoverEngine.endGame(officialButtonFallbackChannelId)
console.log('✅ 报名面板正式开始按钮在原私密回复失败时会补发主持人答案')
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected: FAIL with an error similar to `interaction.followUp is not a function` or an uncaught `模拟按钮路径主持人私密面板展示失败`, because `dealAndNotify(...)` currently does not catch the final host `editReply(...)` failure.

- [ ] **Step 3: Do not implement yet**

Leave the failure in place until Task 2 implements the fallback.

---

### Task 2: Implement Host Secret Delivery Fallback

**Files:**
- Modify: `src/commands/undercover.ts:899-954`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Add helper functions below `dealAndNotify(...)`**

Add these functions after `dealAndNotify(...)` and before `sendWordDm(...)`:

```ts
async function sendHostSecretWithFallback(
  interaction: UndercoverInteraction,
  game: UndercoverGame,
  hostSecretContent: string,
) {
  const secretPayload = panel(hostSecretContent)

  try {
    await interaction.editReply(secretPayload)
    return
  } catch (error) {
    console.error('[Undercover] 编辑主持人答案私密回复失败:', error)
  }

  if ('followUp' in interaction && typeof interaction.followUp === 'function') {
    try {
      await interaction.followUp({ ...secretPayload, ephemeral: true })
      return
    } catch (error) {
      console.error('[Undercover] 补发主持人答案私密回复失败:', error)
    }

    try {
      await interaction.followUp({
        content: '❌ 主持人答案发送失败，请使用 `/卧底 观众偷看` 查看本局答案。',
        ephemeral: true,
      })
      return
    } catch (error) {
      console.error('[Undercover] 补发主持人答案失败提示失败:', error)
    }
  }

  const sentDm = await sendHostSecretDm(interaction, game.hostId, hostSecretContent)
  if (sentDm) return

  await sendPublicHostSecretRecoveryHint(interaction)
}

async function sendHostSecretDm(
  interaction: UndercoverInteraction,
  hostId: string,
  hostSecretContent: string,
): Promise<boolean> {
  try {
    const user = await interaction.client.users.fetch(hostId)
    await user.send(panel(hostSecretContent))
    return true
  } catch (error) {
    console.error(`[Undercover] 私信主持人 ${hostId} 答案失败:`, error)
    return false
  }
}

async function sendPublicHostSecretRecoveryHint(interaction: UndercoverInteraction) {
  const channel = interaction.channel
  if (!channel || !('send' in channel)) return

  await channel.send(panel(
    '## ⚠️ 主持人答案发送失败\n\n' +
    '主持人请使用 `/卧底 观众偷看` 查看本局答案。',
  )).catch(error => {
    console.error('[Undercover] 发送主持人答案公开兜底提示失败:', error)
  })
}
```

- [ ] **Step 2: Replace the final host `editReply(...)` in `dealAndNotify(...)`**

Replace this code:

```ts
await interaction.editReply(panel(formatHostSecret({
  civilianWord: result.civilianWord,
  undercoverWord: result.undercoverWord,
  undercoverName,
  allowLying: game.allowLying,
  failedDmNames,
})))
```

with:

```ts
await sendHostSecretWithFallback(interaction, game, formatHostSecret({
  civilianWord: result.civilianWord,
  undercoverWord: result.undercoverWord,
  undercoverName,
  allowLying: game.allowLying,
  failedDmNames,
}))
```

- [ ] **Step 3: Run the focused test script**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected: PASS through the new line `✅ 报名面板正式开始按钮在原私密回复失败时会补发主持人答案`.

- [ ] **Step 4: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS with `tsc` completing without errors.

- [ ] **Step 5: Commit this task if commits are requested**

```bash
git add src/commands/undercover.ts src/test-undercover.ts
git commit -m "fix: fallback host secret delivery"
```

---

### Task 3: Allow Host To Use Peek Command

**Files:**
- Modify: `src/commands/undercover.ts:449-480`
- Modify: `src/test-undercover.ts:449-498`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Change the existing host peek test to expect a private answer**

Replace the current host peek block:

```ts
let hostPeekReply: any
await executeUndercoverCommand({
  guild: {},
  channelId,
  user: { id: hostId },
  options: { getSubcommand: () => '观众偷看' },
  reply: async (payload: any) => {
    hostPeekReply = payload
  },
} as any)
assert.equal(hostPeekReply.content, '❌ 主持人已经知道答案，不能使用观众偷看。')
```

with:

```ts
let hostPeekDeferred = false
let hostPeekEdit: any
await executeUndercoverCommand({
  guild: {
    members: {
      fetch: async () => ({ displayName: '用户A' }),
    },
  },
  client: {
    users: {
      fetch: async () => ({ displayName: '用户A', username: 'user-a' }),
    },
  },
  channelId,
  user: { id: hostId },
  options: { getSubcommand: () => '观众偷看' },
  deferReply: async (payload: any) => {
    hostPeekDeferred = payload?.ephemeral === true
  },
  editReply: async (payload: any) => {
    hostPeekEdit = payload
  },
} as any)
assert.equal(hostPeekDeferred, true)
assert.equal(getPanelText(hostPeekEdit), audiencePeek)
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected: FAIL because `handleAudiencePeek(...)` currently replies `❌ 主持人已经知道答案，不能使用观众偷看。`.

- [ ] **Step 3: Remove the host rejection in `handleAudiencePeek(...)`**

Delete this block:

```ts
if (game.hostId === interaction.user.id) {
  await interaction.reply({ content: '❌ 主持人已经知道答案，不能使用观众偷看。', ephemeral: true })
  return
}
```

Leave the participant rejection unchanged:

```ts
if (game.players.some(player => player.userId === interaction.user.id)) {
  await interaction.reply({ content: '❌ 参与者不能使用观众偷看。', ephemeral: true })
  return
}
```

- [ ] **Step 4: Update the test success message**

Replace:

```ts
console.log('✅ 观众偷看仅允许非主持人、非参与者使用，并会私密返回答案')
```

with:

```ts
console.log('✅ 观众偷看允许主持人和非参与旁观者使用，并会私密返回答案')
```

- [ ] **Step 5: Run verification**

Run:

```bash
npx tsx src/test-undercover.ts
npm run build
```

Expected: both commands PASS.

- [ ] **Step 6: Commit this task if commits are requested**

```bash
git add src/commands/undercover.ts src/test-undercover.ts
git commit -m "fix: allow host to peek undercover answer"
```

---

### Task 4: Add Failing Tests For History Button Acknowledgement

**Files:**
- Modify: `src/test-undercover.ts:293-316`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Update the existing no-history button test to expect `deferReply` then `editReply`**

Replace the interaction mock and assertions around `speechHistoryReply` with:

```ts
let speechHistoryReply: any
let speechHistoryDeferred = false
await handleUndercoverButton({
  customId: 'undercover_history_open',
  channelId: speechPanelChannelId,
  user: { id: 's3' },
  guild: {
    members: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}` }),
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `玩家${userId}`, username: userId }),
    },
  },
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
    speechHistoryDeferred = true
  },
  editReply: async (payload: any) => {
    speechHistoryReply = payload
  },
} as any)
assert.equal(speechHistoryDeferred, true)
assert.equal(getPanelText(speechHistoryReply).includes('暂无发言记录'), true)
assert.equal(speechHistoryReply.components.length, 1)
```

- [ ] **Step 2: Add a completed-history test that proves acknowledgement happens before nickname fetch**

Insert this block after the no-history assertions and before `await UndercoverEngine.endGame(speechPanelChannelId)`:

```ts
const completedHistoryChannelId = 'undercover-completed-history-channel'
await UndercoverEngine.startGame(completedHistoryChannelId, hostId, {
  wordSource: 'custom',
  civilianWord: '春天',
  undercoverWord: '秋天',
  allowLying: false,
})
await UndercoverEngine.addPlayer(completedHistoryChannelId, 'h1')
await UndercoverEngine.addPlayer(completedHistoryChannelId, 'h2')
await UndercoverEngine.addPlayer(completedHistoryChannelId, 'h3')
await UndercoverEngine.dealWords(completedHistoryChannelId, sequenceRng([0, 0, 0]))
await UndercoverEngine.startSpeechRound(completedHistoryChannelId)
const completedHistoryOrder = UndercoverEngine.getGame(completedHistoryChannelId)?.currentSpeech?.order ?? []
for (const userId of completedHistoryOrder) {
  const result = await UndercoverEngine.submitSpeech(completedHistoryChannelId, userId, `${userId} 的历史发言`)
  assert.equal(result.ok, true)
}

let completedHistoryDeferred = false
let completedHistoryReply: any
await handleUndercoverButton({
  customId: 'undercover_history_open',
  channelId: completedHistoryChannelId,
  user: { id: 'h1' },
  guild: {
    members: {
      fetch: async (userId: string) => {
        assert.equal(completedHistoryDeferred, true)
        return { displayName: `历史玩家${userId}` }
      },
    },
  },
  client: {
    users: {
      fetch: async (userId: string) => ({ displayName: `历史玩家${userId}`, username: userId }),
    },
  },
  deferReply: async (payload: any) => {
    assert.equal(payload.ephemeral, true)
    completedHistoryDeferred = true
  },
  editReply: async (payload: any) => {
    completedHistoryReply = payload
  },
} as any)
assert.equal(completedHistoryDeferred, true)
assert.equal(getPanelText(completedHistoryReply).includes('的历史发言'), true)
await UndercoverEngine.endGame(completedHistoryChannelId)
console.log('✅ 查看历史会先完成交互响应，再加载历史内容')
```

- [ ] **Step 3: Run the test and confirm it fails**

Run:

```bash
npx tsx src/test-undercover.ts
```

Expected: FAIL because `handleHistoryButton(...)` currently calls `reply(...)` directly and does not call `deferReply(...)` first.

---

### Task 5: Implement History Button Early Acknowledgement

**Files:**
- Modify: `src/commands/undercover.ts:1151-1167`
- Test: `src/test-undercover.ts`

- [ ] **Step 1: Replace `handleHistoryButton(...)` with defer-first logic**

Replace the entire function:

```ts
async function handleHistoryButton(
  interaction: ButtonInteraction,
  page: number,
  update = false,
) {
  const game = UndercoverEngine.getGame(interaction.channelId)
  if (!game) {
    const payload = { content: '❌ 当前频道没有进行中的谁是卧底。', ephemeral: true }
    if (update) await interaction.update({ content: payload.content, components: [] })
    else await interaction.reply(payload)
    return
  }

  const payload = await buildHistoryPanel(interaction, game, page, interaction.user.id)
  if (update) await interaction.update(payload)
  else await interaction.reply({ ...payload, ephemeral: true })
}
```

with:

```ts
async function handleHistoryButton(
  interaction: ButtonInteraction,
  page: number,
  update = false,
) {
  if (update) await interaction.deferUpdate()
  else await interaction.deferReply({ ephemeral: true })

  try {
    const game = UndercoverEngine.getGame(interaction.channelId)
    if (!game) {
      await interaction.editReply({ content: '❌ 当前频道没有进行中的谁是卧底。', components: [] })
      return
    }

    const payload = await buildHistoryPanel(interaction, game, page, interaction.user.id)
    await interaction.editReply(payload)
  } catch (error) {
    console.error('[Undercover] 查看发言历史失败:', error)
    await interaction.editReply({
      content: '❌ 查看历史失败，请稍后再试。',
      components: [],
    }).catch(() => undefined)
  }
}
```

- [ ] **Step 2: Run verification**

Run:

```bash
npx tsx src/test-undercover.ts
npm run build
```

Expected: both commands PASS.

- [ ] **Step 3: Commit this task if commits are requested**

```bash
git add src/commands/undercover.ts src/test-undercover.ts
git commit -m "fix: acknowledge history button before loading"
```

---

### Task 6: Final Verification And Manual Runtime Check

**Files:**
- Verify only: `src/commands/undercover.ts`
- Verify only: `src/test-undercover.ts`

- [ ] **Step 1: Run all available automated checks**

Run:

```bash
npm run build
npx tsx src/test-undercover.ts
```

Expected:

```text
> handle-discord-bot@1.0.0 build
> tsc

🎉 谁是卧底核心逻辑测试全部通过！
```

- [ ] **Step 2: Check git diff scope**

Run:

```bash
git diff -- src/commands/undercover.ts src/test-undercover.ts
git status --short
```

Expected:

```text
 M src/commands/undercover.ts
 M src/test-undercover.ts
```

No unrelated tracked files should be modified.

- [ ] **Step 3: Runtime check with the user on Discord**

Ask the user to verify these three paths on the server:

```text
1. Start a game from the signup panel button.
2. Confirm the host sees the private answer, or gets a private recovery prompt.
3. Confirm the host can run /卧底 观众偷看 after words are dealt.
4. Click 查看历史 during a speech panel and confirm the button does not stay stuck on "...".
```

Expected: no public message leaks the words or undercover identity.

- [ ] **Step 4: Commit final state if commits are requested**

```bash
git add src/commands/undercover.ts src/test-undercover.ts
git commit -m "fix: improve undercover host recovery and history interactions"
```

---

## Self-Review

**Spec coverage:**  
The plan covers host-secret fallback, host access to `/卧底 观众偷看`, and history-button early acknowledgement.

**Placeholder scan:**  
No `TBD`, `TODO`, or unspecified edge handling remains. Each code-changing step includes the exact code to add, delete, or replace.

**Type consistency:**  
The helper functions use existing local types: `UndercoverInteraction`, `UndercoverGame`, `panel(...)`, and existing discord.js interaction methods already used in the file.

**Entry point closure:**  
No new Discord command or button ID is introduced. Existing entry points remain `handleUndercoverButton(...)` and `/卧底 观众偷看`.
