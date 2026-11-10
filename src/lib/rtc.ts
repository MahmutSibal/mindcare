// WebRTC görüşmesi ve Supabase Realtime sinyalleşmesi.
// Terapist ve danışan istemcileri bu modülü ortak kullanır.
//
// Akış:
//   1. Terapist anonim oturum açar, rastgele oda kimliği + davet anahtarı üretir,
//      anahtarın SHA-256 özetini `create_call_room` ile kaydeder.
//   2. Danışan davet bağlantısını açar, anonim oturum açar, `join_call_room`
//      ile anahtarı doğrular (tek kullanımlık, süreli).
//   3. İki taraf `room:<id>` özel Realtime kanalına abone olur. Kanala yalnızca
//      odanın iki katılımcısı erişebilir (realtime.messages RLS).
//   4. Danışan `hello` gönderir → terapist ICE ayarlarını ve SDP offer'ı yollar →
//      danışan answer döner → ICE adayları karşılıklı iletilir.
//   5. Görüşme bitince terapist `end_call_room` çağırır; kanal erişimi kapanır.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_STUN, SUPABASE_KEY, SUPABASE_URL } from "./config";
import type { Answers, TestDefinition } from "./tests";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "mindcare-signal-auth" },
    });
  }
  return client;
}

async function ensureSignedIn(): Promise<void> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    const { error } = await sb.auth.signInAnonymously();
    if (error) {
      if (error.message.toLowerCase().includes("anonymous")) {
        throw new Error("Supabase projesinde anonim girişler kapalı. Authentication → Sign In / Providers → \"Allow anonymous sign-ins\" açılmalı.");
      }
      throw new Error(`Sinyalleşme sunucusuna bağlanılamadı: ${error.message}`);
    }
  }
  // Realtime erişim anahtarını supabase-js oturumdan kendisi alır; elle setAuth gerekmez.
}

function randomToken(bytes: number): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ───────────────────────────── Oda yönetimi ─────────────────────────────

export interface Invite {
  room: string;
  token: string;
  expiresAt: Date;
  link: string;
}

export async function createInvite(patientAppUrl: string, ttlMinutes: number): Promise<Invite> {
  await ensureSignedIn();
  const room = randomToken(16);
  const token = randomToken(32);
  const { data, error } = await supabase().rpc("create_call_room", {
    p_room: room,
    p_token_hash: await sha256Hex(token),
    p_ttl_minutes: ttlMinutes,
  });
  if (error) throw new Error(`Davet oluşturulamadı: ${error.message}`);
  // Anahtar URL'nin # kısmında: tarayıcı bu kısmı hiçbir sunucuya göndermez.
  const link = `${patientAppUrl.replace(/\/+$/, "")}/#r=${room}&t=${token}`;
  return { room, token, expiresAt: new Date(data as string), link };
}

export type JoinResult = "ok" | "not_found" | "ended" | "used" | "expired" | "host" | "unauthenticated";

export async function joinRoom(room: string, token: string): Promise<JoinResult> {
  await ensureSignedIn();
  const { data, error } = await supabase().rpc("join_call_room", { p_room: room, p_token: token });
  if (error) throw new Error(`Davet doğrulanamadı: ${error.message}`);
  return data as JoinResult;
}

export async function endRoom(room: string): Promise<void> {
  await supabase().rpc("end_call_room", { p_room: room });
}

// ───────────────────────────── Görüşme ─────────────────────────────

export type CallState = "idle" | "waiting" | "connecting" | "connected" | "reconnecting" | "ended" | "failed";

export interface VideoStats {
  width: number | null;
  height: number | null;
  fps: number | null;
  kbps: number | null;
}

export interface CallStats {
  route: "p2p" | "turn" | "unknown";
  rttMs: number | null;
  packetLossPct: number | null;
  /** Gönderilen görüntü ve tarayıcının kaliteyi neden kıstığı ("bandwidth", "cpu", "none"). */
  outgoing?: VideoStats & { limitation: string | null; codec: string | null };
  /** Karşıdan gelen görüntü. */
  incoming?: VideoStats;
  /** Tarayıcının tahmini giden bant genişliği. */
  availableKbps?: number | null;
}

export interface CallHandlers {
  onState: (s: CallState) => void;
  onRemoteStream: (s: MediaStream | null) => void;
  onStats?: (s: CallStats) => void;
  onMessage?: (m: ChannelMessage) => void;
  onIceConfig?: (servers: RTCIceServer[]) => void;
}

// Veri kanalı mesajları. Kanal iki uç arasında DTLS ile şifrelidir ve sunucudan geçmez
// (TURN kullanılsa bile aktarıcı içeriği okuyamaz).
export type ChannelMessage =
  | { type: "text"; text: string }
  | { type: "material"; title: string; category: string }
  // Terapist → danışan: doldurulacak test.
  | { type: "test"; requestId: string; title: string; instructions: string | null; definition: TestDefinition }
  // Danışan → terapist: test ulaştı ve ekranda. Gelmezse danışan sayfası eski sürümdür.
  | { type: "test_received"; requestId: string }
  // Terapist → danışan: gönderilen test geri çekildi.
  | { type: "test_cancel"; requestId: string }
  // Danışan → terapist: test cevapları. Puan terapist tarafında hesaplanır.
  | { type: "test_answers"; requestId: string; answers: Answers }
  // Terapist → danışan: ödev. Danışan sayfası kalıcı değildir; danışan ödevi indirip saklar.
  | { type: "homework"; id: string; title: string; description: string | null; due: string | null }
  // Danışan → terapist: ödev ekrana ulaştı.
  | { type: "homework_received"; id: string }
  // Terapist → danışan: materyal gösterimi. Alıntıda metin doğrudan gelir; görsel ve
  // belgede ardından `material_chunk` parçaları (base64) ve `material_end` gelir.
  | { type: "material_show"; id: string; title: string; kind: "image" | "document" | "quote"; mime: string; size: number; text?: string }
  | { type: "material_chunk"; id: string; data: string }
  | { type: "material_end"; id: string }
  | { type: "material_hide"; id: string }
  // Danışan → terapist: materyal eksiksiz ulaştı ve gösteriliyor.
  | { type: "material_received"; id: string }
  // Terapist → danışan: görüntüde ekran paylaşımı veya materyal videosu var mı. Danışan sayfası
  // bu durumda görüntüyü kırpmadan sığdırır (yatay ekran dikey telefonda yarım görünmesin).
  | { type: "content_share"; active: boolean };

export type Signal =
  | { kind: "hello" }
  | { kind: "config"; iceServers: RTCIceServer[] }
  // `restart`: mevcut bağlantıda yeni ağ yolu arama (ICE restart); danışan bağlantıyı yıkmadan yanıtlar.
  | { kind: "offer"; sdp: RTCSessionDescriptionInit; restart?: boolean }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  | { kind: "bye" };

/** Sinyalleşme taşıyıcısı. Canlıda Supabase Realtime; testlerde aynı sayfa içi bir köprü. */
export interface SignalTransport {
  send(s: Signal): void;
  close(): Promise<void>;
}
export type TransportFactory = (room: string, onSignal: (s: Signal) => void) => Promise<SignalTransport>;

/** Supabase Realtime özel kanalı üzerinden sinyalleşme (varsayılan). */
export const supabaseTransport: TransportFactory = async (room, onSignal) => {
  await ensureSignedIn();
  const ch = supabase().channel(`room:${room}`, {
    config: { private: true, broadcast: { self: false, ack: true } },
  });
  ch.on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload as Signal));
  await new Promise<void>((resolve, reject) => {
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error(`Sinyalleşme kanalına bağlanılamadı${err ? `: ${err.message}` : ""}`));
      }
    });
  });
  return {
    send: (s) => void ch.send({ type: "broadcast", event: "signal", payload: s }),
    close: async () => {
      await supabase().removeChannel(ch);
    },
  };
};

/** Kopma bu kadar sürerse terapist tarafı yeni ağ yolu arar (ICE restart). */
const RESTART_AFTER_MS = 3000;
/** Yeni ağ yolu araması bu aralıkla tekrarlanır. */
const RESTART_RETRY_MS = 8000;
/** Bağlantı bu kadar süre dönmezse danışan bağlantının baştan kurulmasını ister. */
const GUEST_REBUILD_AFTER_MS = 15000;

export interface TurnConfig {
  url: string;
  username: string;
  credential: string;
}

export function buildIceServers(turn?: TurnConfig | null): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: DEFAULT_STUN }];
  if (turn?.url) {
    servers.push({
      urls: turn.url.split(",").map((u) => u.trim()).filter(Boolean),
      username: turn.username,
      credential: turn.credential,
    });
  }
  return servers;
}

/**
 * Görüntüde H.264'ü öne alır: bilgisayar ve telefonlarda donanım hızlandırmalı olduğu için
 * işlemci yükü düşer ve "işlemci yetişemiyor" kaynaklı kalite düşüşü azalır. H.264 yoksa
 * tarayıcının kendi sırası (VP8 vb.) geçerli kalır.
 */
function preferHardwareCodec(pc: RTCPeerConnection) {
  const codecs = RTCRtpReceiver.getCapabilities?.("video")?.codecs;
  if (!codecs?.some((c) => /h264/i.test(c.mimeType))) return;
  const rank = (c: { mimeType: string }) => (/h264/i.test(c.mimeType) ? 0 : 1);
  const ordered = [...codecs].sort((a, b) => rank(a) - rank(b));
  for (const t of pc.getTransceivers()) {
    if (t.sender.track?.kind !== "video") continue;
    try {
      t.setCodecPreferences(ordered);
    } catch {
      /* desteklenmiyorsa tarayıcının sırası kalır */
    }
  }
}

export class Call {
  private transport: SignalTransport | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private videoProfile: "camera" | "screen" = "camera";
  private lastLoss = { lost: 0, received: 0 };
  private lastBytes = { sent: 0, received: 0, at: 0 };
  private iceServers: RTCIceServer[];
  private closed = false;

  constructor(
    private role: "host" | "guest",
    private room: string,
    private localStream: MediaStream,
    private h: CallHandlers,
    iceServers?: RTCIceServer[],
    private transportFactory: TransportFactory = supabaseTransport,
  ) {
    this.iceServers = iceServers ?? buildIceServers();
  }

  async start(): Promise<void> {
    this.h.onState(this.role === "host" ? "waiting" : "connecting");
    this.transport = await this.transportFactory(this.room, (s) => this.onSignal(s));
    if (this.role === "guest") this.send({ kind: "hello" });
  }

  /** Teşhis ve test için: bağlantının o anki durumu. */
  get connectionState(): RTCPeerConnectionState | "none" {
    return this.pc?.connectionState ?? "none";
  }

  /** Test için: terapist tarafında yeni ağ yolu aramasını hemen başlatır. */
  async forceIceRestart(): Promise<void> {
    await this.restartIce();
  }

  /** Kamera/mikrofon akışı değiştiğinde (ör. kamera kapatılıp açıldığında) iz güncellenir. */
  replaceTrack(kind: "audio" | "video", track: MediaStreamTrack | null) {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === kind || (!s.track && kind === "video"));
    sender?.replaceTrack(track).catch(() => {});
  }

  /**
   * Giden görüntünün kodlama ayarları. Ekran paylaşımında yazı net kalsın diye çözünürlük
   * korunur ve bit hızı yükseltilir (kare hızı düşebilir); kamerada denge tercih edilir.
   */
  async setVideoProfile(profile: "camera" | "screen"): Promise<void> {
    this.videoProfile = profile;
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const p = sender.getParameters();
    const enc = p.encodings?.[0];
    if (!enc) return; // Henüz müzakere edilmemiş; kodlama listesi eklenemez.
    // Tavan değerler: bağlantı elvermezse tarayıcı kendiliğinden daha düşüğe iner.
    enc.maxBitrate = profile === "screen" ? 3_000_000 : 2_500_000;
    enc.maxFramerate = profile === "screen" ? 15 : 30;
    p.degradationPreference = profile === "screen" ? "maintain-resolution" : "balanced";
    await sender.setParameters(p).catch(() => {});
  }

  /** Mesajı veri kanalından gönderir; kanal açık değilse `false` döner. */
  sendMessage(m: ChannelMessage): boolean {
    if (this.dc?.readyState !== "open") return false;
    this.dc.send(JSON.stringify(m));
    return true;
  }

  /**
   * Büyük aktarımlar için: kanal tamponu dolunca boşalmasını bekleyerek gönderir.
   * Kanal kapanırsa veya yeniden kurulursa `false` döner.
   */
  async sendBuffered(m: ChannelMessage): Promise<boolean> {
    const dc = this.dc;
    if (dc?.readyState !== "open") return false;
    if (dc.bufferedAmount > 4 * 1024 * 1024) {
      dc.bufferedAmountLowThreshold = 1024 * 1024;
      await new Promise<void>((resolve) => {
        const done = () => {
          dc.removeEventListener("bufferedamountlow", done);
          dc.removeEventListener("close", done);
          resolve();
        };
        dc.addEventListener("bufferedamountlow", done);
        dc.addEventListener("close", done);
      });
    }
    if (dc !== this.dc || dc.readyState !== "open") return false;
    dc.send(JSON.stringify(m));
    return true;
  }

  async hangup(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.send({ kind: "bye" });
    this.teardownPeer();
    await this.transport?.close();
    this.transport = null;
    if (this.role === "host" && this.transportFactory === supabaseTransport) await endRoom(this.room).catch(() => {});
    this.h.onState("ended");
  }

  // ── iç işlemler ──

  private send(s: Signal) {
    this.transport?.send(s);
  }

  private clearRecovery() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.recoveryTimer = null;
    this.rebuildTimer = null;
  }

  /**
   * Terapist tarafı: mevcut bağlantıyı koruyarak yeni ağ yolu arar (ICE restart). Veri kanalı ve
   * medya izleri yerinde kalır; danışan aynı bağlantı üzerinde yanıtlar. Bağlantı dönene kadar
   * belirli aralıklarla tekrarlanır.
   */
  private async restartIce() {
    const pc = this.pc;
    if (this.role !== "host" || !pc || this.closed) return;
    if (pc.signalingState === "stable") {
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      this.send({ kind: "offer", sdp: pc.localDescription!.toJSON(), restart: true });
    }
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      if (this.pc === pc && pc.connectionState !== "connected") this.restartIce().catch(() => {});
    }, RESTART_RETRY_MS);
  }

  /** Bağlantı kurulunca gönderim önceliklerini ayarlar: ses önce, görüntü profiline göre. */
  private async applySenderPreferences() {
    const audio = this.pc?.getSenders().find((s) => s.track?.kind === "audio");
    if (audio) {
      const p = audio.getParameters();
      const enc = p.encodings?.[0];
      if (enc) {
        // Bant daraldığında konuşma görüntüden önce gelsin.
        enc.maxBitrate = 64_000; // konuşma için yüksek kalite (Opus varsayılanı ~32 kbps)
        enc.priority = "high";
        enc.networkPriority = "high";
        await audio.setParameters(p).catch(() => {});
      }
    }
    await this.setVideoProfile(this.videoProfile);
  }

  private onConnectionState(pc: RTCPeerConnection) {
    if (this.pc !== pc || this.closed) return;
    const st = pc.connectionState;
    if (st === "connected") {
      this.clearRecovery();
      this.h.onState("connected");
      this.applySenderPreferences().catch(() => {});
      return;
    }
    if (st !== "disconnected" && st !== "failed") return;
    this.h.onState("reconnecting");
    if (this.role === "host") {
      // Kısa kopmalar kendiliğinden düzelir; düzelmezse yeni ağ yolu ara.
      if (st === "failed") this.restartIce().catch(() => {});
      else if (!this.recoveryTimer) {
        this.recoveryTimer = setTimeout(() => {
          this.recoveryTimer = null;
          if (this.pc === pc && pc.connectionState !== "connected") this.restartIce().catch(() => {});
        }, RESTART_AFTER_MS);
      }
    } else if (!this.rebuildTimer) {
      // Danışan: terapistin yeni yol araması işe yaramazsa bağlantının baştan kurulmasını iste.
      this.rebuildTimer = setTimeout(() => {
        this.rebuildTimer = null;
        if (this.pc === pc && pc.connectionState !== "connected") this.send({ kind: "hello" });
      }, GUEST_REBUILD_AFTER_MS);
    }
  }

  private async onSignal(s: Signal) {
    if (this.closed) return;
    try {
      switch (s.kind) {
        case "hello":
          if (this.role !== "host") return;
          // Danışan (yeniden) katıldı: yeni bağlantı kur.
          this.teardownPeer();
          this.send({ kind: "config", iceServers: this.iceServers });
          await this.createPeer();
          this.dc = this.pc!.createDataChannel("control");
          this.wireDataChannel(this.dc);
          await this.pc!.setLocalDescription(await this.pc!.createOffer());
          this.send({ kind: "offer", sdp: this.pc!.localDescription!.toJSON() });
          this.h.onState("connecting");
          break;
        case "config":
          if (this.role !== "guest") return;
          this.iceServers = s.iceServers;
          this.h.onIceConfig?.(s.iceServers);
          break;
        case "offer":
          if (this.role !== "guest") return;
          if (s.restart && this.pc && this.pc.signalingState === "stable") {
            // Yeni ağ yolu: bağlantıyı yıkmadan yanıtla (veri kanalı ve medya korunur).
            await this.pc.setRemoteDescription(s.sdp);
            await this.flushIce();
            await this.pc.setLocalDescription(await this.pc.createAnswer());
            this.send({ kind: "answer", sdp: this.pc.localDescription!.toJSON() });
            break;
          }
          this.teardownPeer();
          await this.createPeer();
          await this.pc!.setRemoteDescription(s.sdp);
          await this.flushIce();
          await this.pc!.setLocalDescription(await this.pc!.createAnswer());
          this.send({ kind: "answer", sdp: this.pc!.localDescription!.toJSON() });
          break;
        case "answer":
          if (this.role !== "host" || !this.pc) return;
          await this.pc.setRemoteDescription(s.sdp);
          await this.flushIce();
          break;
        case "ice":
          if (this.pc?.remoteDescription) await this.pc.addIceCandidate(s.candidate);
          else this.pendingIce.push(s.candidate);
          break;
        case "bye":
          this.teardownPeer();
          if (this.role === "host") this.h.onState("waiting");
          else {
            this.closed = true;
            this.h.onState("ended");
          }
          break;
      }
    } catch (e) {
      console.error("signal error", e);
      this.h.onState("failed");
    }
  }

  private async flushIce() {
    const list = this.pendingIce.splice(0);
    for (const c of list) await this.pc!.addIceCandidate(c).catch(() => {});
  }

  private async createPeer() {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    this.pc = pc;
    for (const t of this.localStream.getTracks()) pc.addTrack(t, this.localStream);
    preferHardwareCodec(pc);
    pc.onicecandidate = (e) => e.candidate && this.send({ kind: "ice", candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => this.h.onRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
    pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.wireDataChannel(e.channel);
    };
    pc.onconnectionstatechange = () => this.onConnectionState(pc);
    this.lastLoss = { lost: 0, received: 0 };
    this.lastBytes = { sent: 0, received: 0, at: 0 };
    this.statsTimer = setInterval(() => this.collectStats(), 2000);
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onmessage = (e) => {
      try {
        this.h.onMessage?.(JSON.parse(e.data) as ChannelMessage);
      } catch {
        /* yok say */
      }
    };
  }

  private teardownPeer() {
    this.clearRecovery();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.dc?.close();
    this.dc = null;
    this.pc?.close();
    this.pc = null;
    this.pendingIce = [];
    this.h.onRemoteStream(null);
  }

  private async collectStats() {
    if (!this.pc || !this.h.onStats) return;
    const report = await this.pc.getStats();
    let route: CallStats["route"] = "unknown";
    let rtt: number | null = null;
    let available: number | null = null;
    let lost = 0;
    let received = 0;
    let out: any = null;
    let inc: any = null;
    const byId = new Map<string, any>();
    report.forEach((r: any) => byId.set(r.id, r));
    report.forEach((r: any) => {
      if (r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected)) {
        const local = byId.get(r.localCandidateId);
        const remote = byId.get(r.remoteCandidateId);
        route = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "turn" : "p2p";
        if (typeof r.currentRoundTripTime === "number") rtt = Math.round(r.currentRoundTripTime * 1000);
        if (typeof r.availableOutgoingBitrate === "number") available = Math.round(r.availableOutgoingBitrate / 1000);
      }
      if (r.type === "inbound-rtp" && !r.isRemote) {
        lost += r.packetsLost ?? 0;
        received += r.packetsReceived ?? 0;
        if (r.kind === "video") inc = r;
      }
      if (r.type === "outbound-rtp" && r.kind === "video" && (!out || (r.frameWidth ?? 0) > (out.frameWidth ?? 0))) out = r;
    });
    const dLost = lost - this.lastLoss.lost;
    const dRecv = received - this.lastLoss.received;
    this.lastLoss = { lost, received };
    const loss = dLost + dRecv > 0 ? Math.max(0, (dLost / (dLost + dRecv)) * 100) : null;

    // Bit hızı: iki ölçüm arasındaki bayt farkından.
    const now = performance.now();
    const sent = out?.bytesSent ?? 0;
    const recv = inc?.bytesReceived ?? 0;
    const dt = this.lastBytes.at ? (now - this.lastBytes.at) / 1000 : 0;
    const kbps = (d: number) => (dt > 0 && d >= 0 ? Math.round((d * 8) / 1000 / dt) : null);
    const outKbps = kbps(sent - this.lastBytes.sent);
    const inKbps = kbps(recv - this.lastBytes.received);
    this.lastBytes = { sent, received: recv, at: now };

    this.h.onStats({
      route,
      rttMs: rtt,
      packetLossPct: loss,
      availableKbps: available,
      outgoing: out ? {
        width: out.frameWidth ?? null,
        height: out.frameHeight ?? null,
        fps: out.framesPerSecond != null ? Math.round(out.framesPerSecond) : null,
        kbps: outKbps,
        limitation: out.qualityLimitationReason ?? null,
        codec: byId.get(out.codecId)?.mimeType?.replace("video/", "") ?? null,
      } : undefined,
      incoming: inc ? {
        width: inc.frameWidth ?? null,
        height: inc.frameHeight ?? null,
        fps: inc.framesPerSecond != null ? Math.round(inc.framesPerSecond) : null,
        kbps: inKbps,
      } : undefined,
    });
  }
}

// ───────────────────────────── Medya ─────────────────────────────

type VoiceConstraints = MediaTrackConstraints & { voiceIsolation?: boolean };

/**
 * Mikrofon ayarları: yankı/gürültü bastırma ve otomatik ses seviyesi; destekleyen cihazlarda
 * ayrıca ses yalıtımı (klavye ve arka plan seslerini konuşmadan ayırır).
 */
function voiceConstraints(): VoiceConstraints {
  const audio: VoiceConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean | undefined>;
  if (supported.voiceIsolation) audio.voiceIsolation = true;
  return audio;
}

/** Mikrofonda o an etkin olan ses işleme (bilgi penceresi için). */
export function audioProcessing(stream: MediaStream | null): { noiseSuppression: boolean; echoCancellation: boolean; voiceIsolation: boolean } | null {
  const track = stream?.getAudioTracks()[0];
  if (!track) return null;
  const s = track.getSettings() as MediaTrackSettings & { voiceIsolation?: boolean };
  return { noiseSuppression: !!s.noiseSuppression, echoCancellation: !!s.echoCancellation, voiceIsolation: !!s.voiceIsolation };
}

export async function getLocalMedia(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      audio: voiceConstraints(),
    });
  } catch (e: any) {
    if (e?.name === "NotAllowedError") throw new Error("Kamera ve mikrofon izni reddedildi.");
    if (e?.name === "NotFoundError") {
      // Kamera yoksa yalnızca ses dene.
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: voiceConstraints() });
      } catch {
        throw new Error("Kamera veya mikrofon bulunamadı.");
      }
    }
    throw new Error("Kamera/mikrofon açılamadı.");
  }
}
