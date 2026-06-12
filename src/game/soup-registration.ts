export const SOUP_REGISTRATION_EMOJI = '✅'

export interface SoupRegistration {
  channelId: string
  messageId: string
  createdAt: number
}

const registrations = new Map<string, SoupRegistration>()

export function hasSoupRegistration(channelId: string): boolean {
  return registrations.has(channelId)
}

export function createSoupRegistration(channelId: string, messageId: string): {
  ok: boolean
  registration?: SoupRegistration
} {
  if (registrations.has(channelId)) return { ok: false }

  const registration: SoupRegistration = {
    channelId,
    messageId,
    createdAt: Date.now(),
  }
  registrations.set(channelId, registration)
  return { ok: true, registration }
}

export function consumeSoupRegistration(channelId: string): SoupRegistration | null {
  const registration = registrations.get(channelId) ?? null
  registrations.delete(channelId)
  return registration
}

export function formatSoupRegistrationMessage(): string {
  return (
    `## 🍲 海龟汤报名开始\n\n` +
    `想在本局开汤时收到私信提醒，请点击 ${SOUP_REGISTRATION_EMOJI} 报名。\n\n` +
    `报名后，汤主使用 \`/海龟汤 开始\` 正式开汤时，Bot 会私信通知你来提问。`
  )
}

export function formatSoupRegistrationDm(): string {
  return `## 🍲 海龟汤\n\n汤面已发布，快来提问！`
}

export function formatSoupRegistrationFailureNotice(names: string[]): string {
  return `## 🍲 海龟汤\n\n⚠️ 有报名者无法收到私信：${names.join('、')}`
}

export function resetSoupRegistrationsForTest(): void {
  registrations.clear()
}
