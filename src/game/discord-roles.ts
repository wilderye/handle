import {
  Guild,
  GuildMember,
  PermissionsBitField,
  Role,
} from 'discord.js'

export const HOST_ROLE_NAMES = ['主持人', '海龟汤主持人'] as const
export const HOST_ROLE_NAME = HOST_ROLE_NAMES[0]
export const UNDERCOVER_NOTIFY_ROLE_ID = '1514934258379001926'

export function isHostRoleName(name: string): boolean {
  return (HOST_ROLE_NAMES as readonly string[]).includes(name)
}

export function memberHasHostRole(member: GuildMember): boolean {
  return member.roles.cache.some(role => isHostRoleName(role.name))
}

export async function findRoleByNames(
  guild: Guild,
  names: readonly string[],
): Promise<Role | null> {
  let role = guild.roles.cache.find(candidate => names.includes(candidate.name))
  if (!role) {
    const roles = await guild.roles.fetch()
    role = roles.find(candidate => names.includes(candidate.name))
  }
  return role ?? null
}

export async function addHostRoleToMember(
  guild: Guild,
  userId: string,
  reason: string,
): Promise<string> {
  let role = await findRoleByNames(guild, HOST_ROLE_NAMES)

  if (!role) {
    const canManageRoles = guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageRoles)
    if (!canManageRoles) {
      return `\n⚠️ 未找到「${HOST_ROLE_NAME}」身份组，且 Bot 无权创建。请手动创建或给予 Bot「管理角色」权限。`
    }

    try {
      role = await guild.roles.create({
        name: HOST_ROLE_NAME,
        color: 0xf1c40f,
        reason,
      })
    } catch (error: any) {
      console.error('[Roles] 创建主持人身份组失败:', error)
      return `\n⚠️ 无法创建「${HOST_ROLE_NAME}」身份组：${error.message}`
    }
  }

  const botMember = guild.members.me
  if (botMember && botMember.roles.highest.position <= role.position) {
    return `\n⚠️ Bot 的角色层级低于「${role.name}」，请在服务器设置中将 Bot 角色拖到该身份组上方。`
  }

  try {
    const member = await guild.members.fetch(userId)
    await member.roles.add(role.id, reason)
    return ''
  } catch (error: any) {
    console.error('[Roles] 赋予主持人身份组失败:', error)
    return `\n⚠️ 无法赋予「${role.name}」身份组：${error.message}`
  }
}

export async function removeHostRoleFromMember(
  guild: Guild,
  userId: string,
  reason: string,
): Promise<void> {
  const role = await findRoleByNames(guild, HOST_ROLE_NAMES)
  if (!role) return

  const member = await guild.members.fetch(userId).catch(() => null)
  if (!member) return

  try {
    await member.roles.remove(role.id, reason)
  } catch (error) {
    console.error('[Roles] 移除主持人身份组失败:', error)
  }
}
