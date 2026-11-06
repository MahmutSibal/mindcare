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

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
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

export interface CallStats {
  route: "p2p" | "turn" | "unknown";
  rttMs: number | null;
  packetLossPct: number | null;
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
  | { type: "test_answers"; requestId: string; answers: Answers };

type Signal =
  | { kind: "hello" }
  | { kind: "config"; iceServers: RTCIceServer[] }
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  | { kind: "bye" };

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

export class Call {
  private channel: RealtimeChannel | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastLoss = { lost: 0, received: 0 };
  private iceServers: RTCIceServer[];
  private closed = false;

  constructor(
    private role: "host" | "guest",
    private room: string,
    private localStream: MediaStream,
    private h: CallHandlers,
    iceServers?: RTCIceServer[],
  ) {
    this.iceServers = iceServers ?? buildIceServers();
  }

  async start(): Promise<void> {
    await ensureSignedIn();
    this.h.onState(this.role === "host" ? "waiting" : "connecting");
    const ch = supabase().channel(`room:${this.room}`, {
      config: { private: true, broadcast: { self: false, ack: true } },
    });
    ch.on("broadcast", { event: "signal" }, ({ payload }) => this.onSignal(payload as Signal));
    await new Promise<void>((resolve, reject) => {
      ch.subscribe((status, err) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(new Error(`Sinyalleşme kanalına bağlanılamadı${err ? `: ${err.message}` : ""}`));
        }
      });
    });
    this.channel = ch;
    if (this.role === "guest") this.send({ kind: "hello" });
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
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const p = sender.getParameters();
    const enc = p.encodings?.[0];
    if (!enc) return; // Henüz müzakere edilmemiş; kodlama listesi eklenemez.
    enc.maxBitrate = profile === "screen" ? 2_500_000 : 1_500_000;
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

  async hangup(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.send({ kind: "bye" });
    this.teardownPeer();
    if (this.channel) await supabase().removeChannel(this.channel);
    this.channel = null;
    if (this.role === "host") await endRoom(this.room).catch(() => {});
    this.h.onState("ended");
  }

  // ── iç işlemler ──

  private send(s: Signal) {
    this.channel?.send({ type: "broadcast", event: "signal", payload: s });
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
    pc.onicecandidate = (e) => e.candidate && this.send({ kind: "ice", candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => this.h.onRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
    pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.wireDataChannel(e.channel);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") this.h.onState("connected");
      else if (st === "disconnected") this.h.onState("reconnecting");
      else if (st === "failed") {
        if (this.role === "host") pc.restartIce();
        this.h.onState("reconnecting");
      }
    };
    this.lastLoss = { lost: 0, received: 0 };
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
    let lost = 0;
    let received = 0;
    const byId = new Map<string, any>();
    report.forEach((r: any) => byId.set(r.id, r));
    report.forEach((r: any) => {
      if (r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected)) {
        const local = byId.get(r.localCandidateId);
        const remote = byId.get(r.remoteCandidateId);
        route = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "turn" : "p2p";
        if (typeof r.currentRoundTripTime === "number") rtt = Math.round(r.currentRoundTripTime * 1000);
      }
      if (r.type === "inbound-rtp" && !r.isRemote) {
        lost += r.packetsLost ?? 0;
        received += r.packetsReceived ?? 0;
      }
    });
    const dLost = lost - this.lastLoss.lost;
    const dRecv = received - this.lastLoss.received;
    this.lastLoss = { lost, received };
    const loss = dLost + dRecv > 0 ? Math.max(0, (dLost / (dLost + dRecv)) * 100) : null;
    this.h.onStats({ route, rttMs: rtt, packetLossPct: loss });
  }
}

// ───────────────────────────── Medya ─────────────────────────────

export async function getLocalMedia(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e: any) {
    if (e?.name === "NotAllowedError") throw new Error("Kamera ve mikrofon izni reddedildi.");
    if (e?.name === "NotFoundError") {
      // Kamera yoksa yalnızca ses dene.
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new Error("Kamera veya mikrofon bulunamadı.");
      }
    }
    throw new Error("Kamera/mikrofon açılamadı.");
  }
}
