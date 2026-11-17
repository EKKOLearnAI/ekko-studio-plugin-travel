import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdir, readFile, writeFile, link, unlink, chmod } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { validateModel } from '../sdk/harness/contracts.mjs'
import { AmapError } from './amap-client.mjs'

export const AMAP_KEY_RECORD = 'amap-key-v1'
const aad = run => {
  const { userId, profile } = run.identity
  if (!Number.isSafeInteger(userId) || typeof profile !== 'string' || !profile) throw new AmapError('storage_error', '无法确认当前用户和 Profile，未读取或保存 Key。')
  return Buffer.from(JSON.stringify(['travel/amap/v1', userId, profile]))
}

export function createKeyStore(dataDir, contract) {
  let pendingKey
  async function masterKey(create) {
    if (!dataDir || !isAbsolute(dataDir)) throw new Error('Missing private data directory')
    const file = join(dataDir, 'amap-key-encryption-v1')
    try {
      const value = await readFile(file)
      if (value.length !== 32) throw new Error('Invalid encryption key')
      await chmod(file, 0o600)
      return value
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error
    }
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    const temporary = join(dataDir, `.amap-key-${randomBytes(16).toString('hex')}`)
    await writeFile(temporary, randomBytes(32), { flag: 'wx', mode: 0o600 })
    try { await link(temporary, file) } catch (error) { if (error.code !== 'EEXIST') throw error }
    finally { await unlink(temporary) }
    return masterKey(false)
  }
  async function encryptionKey(create) {
    if (!pendingKey) pendingKey = masterKey(create).catch(error => { pendingKey = undefined; throw error })
    return pendingKey
  }
  return {
    async read(run) {
      try {
        run.signal.throwIfAborted()
        const binding = aad(run), record = await run.state.profile.get(AMAP_KEY_RECORD)
        if (record === undefined) return undefined
        validateModel(contract, 'amap-key-envelope', record)
        const decipher = createDecipheriv('aes-256-gcm', await encryptionKey(false), Buffer.from(record.iv, 'base64'))
        decipher.setAAD(binding); decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
        const key = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8')
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error('Invalid stored key')
        run.signal.throwIfAborted()
        return { key, updatedAt: record.updatedAt }
      } catch { throw new AmapError('storage_error', '无法读取高德 Key，请重新配置；原记录未被修改。') }
    },
    async save(run, key) {
      try {
        const binding = aad(run), iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', await encryptionKey(true), iv)
        cipher.setAAD(binding)
        const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]).toString('base64')
        const record = validateModel(contract, 'amap-key-envelope', { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext, updatedAt: Date.now() })
        run.signal.throwIfAborted()
        await run.state.profile.set(AMAP_KEY_RECORD, record)
        return record.updatedAt
      } catch { throw new AmapError('storage_error', '高德 Key 保存失败，请重试。') }
    },
    async clear(run) {
      try { aad(run); run.signal.throwIfAborted(); await run.state.profile.delete(AMAP_KEY_RECORD) }
      catch { throw new AmapError('storage_error', '高德 Key 清除失败，请重试。') }
    },
  }
}
