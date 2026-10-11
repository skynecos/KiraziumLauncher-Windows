import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { MicrosoftAuthenticator } from '@xmcl/user'
import type { XBoxResponse } from '@xmcl/user'

export interface AccountView { name: string; id: string; microsoft: boolean; loginReady: boolean }
export interface OnlineSession { name: string; id: string; accessToken: string; expiresAt: number }
interface Vault { encryptString(value: string): Buffer; decryptString(value: Buffer): string; isEncryptionAvailable(): boolean }
const OAUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'

export class AccountService {
  private session: OnlineSession | null = null
  private refreshToken = ''
  private pending: AbortController | null = null
  constructor(private root: string, private clientId: string, private vault: Vault) {}
  private get legacy(): boolean { return /^[a-f0-9]{16}$/i.test(this.clientId) }
  private get scope(): string { return this.legacy ? 'service::user.auth.xboxlive.com::MBI_SSL' : 'XboxLive.signin offline_access' }
  view(): AccountView { return { name: this.session?.name ?? '', id: this.session?.id ?? '', microsoft: !!this.refreshToken, loginReady: !!this.clientId } }
  async restore(): Promise<void> {
    try {
      const record = JSON.parse(this.vault.decryptString(await readFile(join(this.root, 'microsoft-account.bin'))))
      if (record.clientId !== this.clientId || typeof record.refreshToken !== 'string' || !record.refreshToken || !/^[a-f0-9]{32}$/i.test(record.id) || !/^[A-Za-z0-9_]{3,16}$/.test(record.name)) return
      this.refreshToken = record.refreshToken
      this.session = { id: record.id, name: record.name, accessToken: '', expiresAt: 0 }
    } catch { /* No saved account, or Windows could not decrypt it. */ }
  }
  private async request(path: string, parameters: URLSearchParams, signal?: AbortSignal): Promise<Record<string, any>> {
    const url = this.legacy ? `https://login.live.com/${path === 'devicecode' ? 'oauth20_connect.srf' : 'oauth20_token.srf'}` : `${OAUTH}/${path}`
    const response = await fetch(url, { method: 'POST', body: parameters, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
    return response.json()
  }
  async signIn(onCode: (code: string) => Promise<void>): Promise<AccountView> {
    if (!this.clientId) throw new Error('Microsoft girişi için Kirazium uygulama kaydı henüz yapılandırılmadı.')
    if (this.pending) throw new Error('Microsoft girişi zaten devam ediyor.')
    if (!this.vault.isEncryptionAvailable()) throw new Error('Windows güvenli hesap saklama kullanılamıyor.')
    const controller = new AbortController()
    this.pending = controller
    try {
      const parameters = new URLSearchParams({ client_id: this.clientId, scope: this.scope })
      if (this.legacy) parameters.set('response_type', 'device_code')
      const device = await this.request('devicecode', parameters, controller.signal)
      if (!device.device_code || !device.user_code || !device.expires_in) throw new Error('Microsoft giriş kodu alınamadı. Uygulama kaydını kontrol et.')
      await onCode(String(device.user_code))
      let interval = Math.max(5, Number(device.interval) || 5)
      const deadline = Date.now() + Math.min(Number(device.expires_in), 900) * 1000
      while (Date.now() < deadline) {
        await delay(interval * 1000, undefined, { signal: controller.signal })
        const token = await this.request('token', new URLSearchParams({ client_id: this.clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code }), controller.signal)
        if (token.error === 'authorization_pending') continue
        if (token.error === 'slow_down') { interval += 5; continue }
        if (token.error || !token.access_token || !token.refresh_token) throw new Error('Microsoft girişi tamamlanamadı veya iptal edildi.')
        await this.accept(String(token.access_token), String(token.refresh_token), controller.signal)
        return this.view()
      }
      throw new Error('Microsoft giriş kodunun süresi doldu. Tekrar giriş yap.')
    } finally { this.pending = null }
  }
  private async accept(oauthToken: string, refreshToken: string, signal?: AbortSignal): Promise<void> {
    const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)
    const auth = new MicrosoftAuthenticator({})
    let xbox: XBoxResponse
    if (this.legacy) {
      // Live's legacy MBI token is sent unchanged, matching the mobile launcher.
      const response = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: oauthToken }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }),
        signal: boundedSignal,
      })
      if (!response.ok) throw new Error('Xbox Live hesabı doğrulanamadı.')
      xbox = await response.json() as XBoxResponse
    } else xbox = await auth.authenticateXboxLive(oauthToken, boundedSignal)
    const xsts = await auth.authorizeXboxLive(xbox.Token, 'rp://api.minecraftservices.com/', boundedSignal)
    const token = await auth.loginMinecraftWithXBox(xsts.DisplayClaims.xui[0].uhs, xsts.Token, boundedSignal)
    if (typeof token.access_token !== 'string' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error('Minecraft oturum yanıtı geçersiz.')
    const ownership = await fetch('https://api.minecraftservices.com/entitlements/mcstore', { headers: { Authorization: `Bearer ${token.access_token}` }, signal: boundedSignal })
    if (!ownership.ok) throw new Error('Minecraft Java lisansı doğrulanamadı.')
    const entitlement = await ownership.json() as { items?: Array<{ name?: string }> }
    if (!entitlement.items?.some(item => item.name === 'game_minecraft' || item.name === 'product_minecraft')) throw new Error('Bu Microsoft hesabında Minecraft Java lisansı bulunamadı.')
    const profileResponse = await fetch('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${token.access_token}` }, signal: boundedSignal })
    if (!profileResponse.ok) throw new Error('Minecraft oyuncu profili doğrulanamadı.')
    const profile = await profileResponse.json() as { id: string; name: string }
    if (typeof profile.id !== 'string' || typeof profile.name !== 'string' || !/^[a-f0-9]{32}$/i.test(profile.id) || !/^[A-Za-z0-9_]{3,16}$/.test(profile.name)) throw new Error('Minecraft profili geçersiz.')
    if (boundedSignal.aborted) throw new Error('Giriş iptal edildi.')
    await mkdir(this.root, { recursive: true })
    const temporary = join(this.root, 'microsoft-account.tmp')
    await writeFile(temporary, this.vault.encryptString(JSON.stringify({ clientId: this.clientId, refreshToken, id: profile.id, name: profile.name })))
    await rename(temporary, join(this.root, 'microsoft-account.bin'))
    this.refreshToken = refreshToken
    this.session = { name: profile.name, id: profile.id, accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 }
  }
  async credentials(): Promise<OnlineSession | null> {
    if (!this.refreshToken) return null
    if (this.session && this.session.accessToken && this.session.expiresAt > Date.now() + 60000) return this.session
    const token = await this.request('token', new URLSearchParams({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: this.refreshToken, scope: this.scope }))
    if (token.error || !token.access_token) throw new Error('Microsoft oturumu yenilenemedi. Yeniden giriş yap.')
    await this.accept(String(token.access_token), String(token.refresh_token || this.refreshToken))
    return this.session
  }
  async logout(): Promise<AccountView> {
    this.pending?.abort()
    this.refreshToken = ''
    this.session = null
    await unlink(join(this.root, 'microsoft-account.bin')).catch(error => { if (error.code !== 'ENOENT') throw error })
    return this.view()
  }
}
