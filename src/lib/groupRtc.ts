// Grup görüşmesi: terapist + en fazla birkaç danışan, her çift arasında doğrudan (mesh) görüntü/ses.
//
// Tasarım:
//  - Tek Realtime kanalı (`group:<oda>`); mesajlar `{from, to, s}` zarfıyla gider. Herkesin oturuma
//    özel rastgele bir kimliği vardır; terapistin kimliği "host".
//  - Danışan katılınca `hello` yollar. Terapist ICE ayarlarını (TURN dahil) yollar ve ona offer verir.
//    Danışanlar kendi aralarında da bağlanır: kimliği küçük olan offer verir (çifte offer çakışması olmaz).
//  - Veri kanalı yalnızca terapist ↔ danışan arasındadır (test, materyal, tuval, dosya). Tuval mesajlarını
//    terapist diğer danışanlara iletir; böylece herkes aynı tuvali görür.
//  - Bağlantı sayısı arttıkça kişi başına video bit hızı düşürülür (yükleme hızı sınırlıdır).

import { ensureSignedIn, randomToken, sha256Hex, supabase, buildIceServers, type CallState, type ChannelMessage, type JoinResult } from "./rtc";

// ───────────────────────────── Oda yönetimi ─────────────────────────────

export const MAX_GROUP_GUESTS = 6;

export interface GroupInvite {
  memberId: string;
  name: string;
  link: string;
  expiresAt: Date;
}

export async function createGroupRoom(maxGuests = MAX_GROUP_GUESTS): Promise<string> {
  await ensureSignedIn();
  const room = randomToken(16);
  const { error } = await supabase().rpc("create_group_room", { p_room: room, p_max: maxGuests });
  if (error) throw new Error(`Grup odası oluşturulamadı: ${error.message}`);
  return room;
}

/** Bir üye için tek kullanımlık davet bağlantısı üretir. Ad ve üye kimliği yalnızca bağlantının # kısmındadır. */
export async function addGroupInvite(
  patientAppUrl: string, room: string, ttlMinutes: number, member: { id: string; name: string },
): Promise<GroupInvite> {
  const token = randomToken(32);
  const { data, error } = await supabase().rpc("add_group_invite", {
    p_room: room, p_token_hash: await sha256Hex(token), p_ttl_minutes: ttlMinutes,
  });
  if (error) throw new Error(`Davet oluşturulamadı: ${error.message}`);
  const first = member.name.trim().split(/\s+/)[0] ?? "";
  const link =
    `${patientAppUrl.replace(/\/+$/, "")}/#g=${room}&t=${token}&n=${encodeURIComponent(first)}&m=${encodeURIComponent(member.id)}`;
  return { memberId: member.id, name: member.name, link, expiresAt: new Date(data as string) };
}

export async function joinGroupRoom(room: string, token: string): Promise<JoinResult> {
  await ensureSignedIn();
  const { data, error } = await supabase().rpc("join_group_room", { p_room: room, p_token: token });
  if (error) throw new Error(`Davet doğrulanamadı: ${error.message}`);
  return data as JoinResult;
}

export async function endGroupRoom(room: string): Promise<void> {
  await supabase().rpc("end_group_room", { p_room: room });
}

// ───────────────────────────── Sinyalleşme ─────────────────────────────

type GSignal =
  | { kind: "hello"; name: string; member: string | null; reply?: boolean }
  | { kind: "config"; iceServers: RTCIceServer[] }
  | { kind: "offer"; sdp: RTCSessionDescriptionInit; restart?: boolean }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  | { kind: "bye" };

export interface Envelope {
  from: string;
  to: string; // kimlik ya da "*"
  s: GSignal;
}

export interface GroupTransport {
  send(e: Envelope): void;
  close(): Promise<void>;
}
export type GroupTransportFactory = (room: string, onEnv: (e: Envelope) => void) => Promise<GroupTransport>;

export const supabaseGroupTransport: GroupTransportFactory = async (room, onEnv) => {
  await ensureSignedIn();
  const ch = supabase().channel(`group:${room}`, { config: { private: true, broadcast: { self: false, ack: true } } });
  ch.on("broadcast", { event: "g" }, ({ payload }) => onEnv(payload as Envelope));
  await new Promise<void>((resolve, reject) => {
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error(`Sinyalleşme kanalına bağlanılamadı${err ? `: ${err.message}` : ""}`));
      }
    });
  });
  return {
    send: (e) => void ch.send({ type: "broadcast", event: "g", payload: e }),
    close: async () => {
      await supabase().removeChannel(ch);
    },
  };
};

// ───────────────────────────── Görüşme ─────────────────────────────

export type PeerState = "connecting" | "connected" | "reconnecting" | "failed";

export interface GroupPeer {
  id: string;
  name: string;
  memberId: string | null;
  stream: MediaStream | null;
  state: PeerState;
}

export interface GroupHandlers {
  onState: (s: CallState) => void;
  onPeers: (peers: GroupPeer[]) => void;
  /** Veri kanalından gelen mesaj; `from` gönderenin kimliği. */
  onMessage?: (m: ChannelMessage, from: string) => void;
}

interface Link {
  id: string;
  name: string;
  memberId: string | null;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  live: RTCDataChannel | null;
  offerer: boolean;
  pendingIce: RTCIceCandidateInit[];
  stream: MediaStream | null;
  state: PeerState;
  timer: ReturnType<typeof setTimeout> | null;
}

const RESTART_AFTER_MS = 3000;
const RESTART_RETRY_MS = 8000;
const REBUILD_AFTER_MS = 15000;
const HOST = "host";

export class GroupCall {
  readonly id: string;
  private transport: GroupTransport | null = null;
  private links = new Map<string, Link>();
  private iceServers: RTCIceServer[];
  private ready: boolean;
  private queued: Envelope[] = [];
  private videoProfile: "camera" | "screen" = "camera";
  private closed = false;

  constructor(
    private role: "host" | "guest",
    private room: string,
    private localStream: MediaStream,
    private me: { name: string; member: string | null },
    private h: GroupHandlers,
    iceServers?: RTCIceServer[],
    private maxGuests = MAX_GROUP_GUESTS,
    private factory: GroupTransportFactory = supabaseGroupTransport,
  ) {
    this.id = role === "host" ? HOST : randomToken(9);
    this.iceServers = iceServers ?? buildIceServers();
    this.ready = role === "host";
  }

  async start(): Promise<void> {
    this.h.onState(this.role === "host" ? "waiting" : "connecting");
    this.transport = await this.factory(this.room, (e) => void this.onEnv(e));
    if (this.role === "guest") this.sendTo("*", { kind: "hello", name: this.me.name, member: this.me.member });
  }

  get peers(): GroupPeer[] {
    return [...this.links.values()].map((l) => ({ id: l.id, name: l.name, memberId: l.memberId, stream: l.stream, state: l.state }));
  }

  // ── dışarıya açık işlemler ──

  /** Veri kanalından gönder. Terapist: tüm danışanlara (ya da `to`); danışan: terapiste. */
  sendMessage(m: ChannelMessage, to?: string, except?: string): boolean {
    const ch = m.type.startsWith("board_") ? "live" : "dc";
    let ok = false;
    for (const l of this.dataTargets(to, except)) {
      const c = (ch === "live" && l.live?.readyState === "open" ? l.live : l.dc) ?? null;
      if (c?.readyState === "open") {
        c.send(JSON.stringify(m));
        ok = true;
      }
    }
    return ok;
  }

  /** Büyük aktarımlar için: tampon dolunca bekler. Hiçbir hedefe gönderilemediyse `false`. */
  async sendBuffered(m: ChannelMessage, to?: string): Promise<boolean> {
    const results = await Promise.all(this.dataTargets(to).map((l) => this.bufferedSend(l, m)));
    return results.length > 0 && results.some(Boolean);
  }

  replaceTrack(kind: "audio" | "video", track: MediaStreamTrack | null) {
    for (const l of this.links.values()) {
      const sender = l.pc.getSenders().find((s) => s.track?.kind === kind || (!s.track && kind === "video"));
      sender?.replaceTrack(track).catch(() => {});
    }
  }

  async setVideoProfile(profile: "camera" | "screen"): Promise<void> {
    this.videoProfile = profile;
    await this.applyBitrates();
  }

  async hangup(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.sendTo("*", { kind: "bye" });
    for (const id of [...this.links.keys()]) this.drop(id, false);
    await this.transport?.close();
    this.transport = null;
    if (this.role === "host" && this.factory === supabaseGroupTransport) await endGroupRoom(this.room).catch(() => {});
    this.h.onState("ended");
  }

  // ── sinyalleşme ──

  private sendTo(to: string, s: GSignal) {
    this.transport?.send({ from: this.id, to, s });
  }

  private async onEnv(e: Envelope) {
    if (this.closed || !e || e.from === this.id || (e.to !== "*" && e.to !== this.id)) return;
    if (typeof e.from !== "string" || e.from.length > 40) return;
    try {
      const s = e.s;
      switch (s.kind) {
        case "hello":
          return this.onHello(e.from, s, e.to === "*");
        case "config":
          if (this.role !== "guest" || e.from !== HOST || this.ready) return;
          this.iceServers = s.iceServers;
          this.ready = true;
          // Hazırım: ben katılmadan önce gelmiş olanlar bana offer versin / ben onlara vereyim.
          this.sendTo("*", { kind: "hello", name: this.me.name, member: this.me.member });
          for (const q of this.queued.splice(0)) await this.onEnv(q);
          return;
        case "offer":
          if (!this.ready) return void this.queued.push(e);
          return await this.onOffer(e.from, s);
        case "answer": {
          const l = this.links.get(e.from);
          if (!l) return;
          await l.pc.setRemoteDescription(s.sdp);
          await this.flushIce(l);
          return;
        }
        case "ice": {
          const l = this.links.get(e.from);
          if (!l) {
            if (!this.ready && this.role === "guest") this.queued.push(e);
            return;
          }
          if (l.pc.remoteDescription) await l.pc.addIceCandidate(s.candidate).catch(() => {});
          else l.pendingIce.push(s.candidate);
          return;
        }
        case "bye":
          this.drop(e.from);
          // Terapist görüşmeyi bitirdi: danışan için görüşme sona erer.
          if (this.role === "guest" && e.from === HOST) await this.hangup();
          return;
      }
    } catch (err) {
      console.error("group signal error", err);
    }
  }

  private async onHello(from: string, s: Extract<GSignal, { kind: "hello" }>, broadcast: boolean) {
    const name = String(s.name ?? "").slice(0, 60) || "Katılımcı";
    const member = typeof s.member === "string" ? s.member.slice(0, 80) : null;
    if (this.role === "host") {
      if (!this.links.has(from) && this.links.size >= this.maxGuests) return; // oda dolu
      this.sendTo(from, { kind: "config", iceServers: this.iceServers });
      await this.connect(from, name, member, true);
      return;
    }
    if (from === HOST || !this.ready) return;
    // Danışan ↔ danışan: kimliği küçük olan offer verir. Büyük olan, küçüğe "sen ver" der.
    if (this.id < from || s.reply) {
      await this.connect(from, name, member, true);
    } else if (broadcast) {
      this.sendTo(from, { kind: "hello", name: this.me.name, member: this.me.member, reply: true });
    }
  }

  private async onOffer(from: string, s: Extract<GSignal, { kind: "offer" }>) {
    const existing = this.links.get(from);
    if (s.restart && existing && existing.pc.signalingState === "stable") {
      await existing.pc.setRemoteDescription(s.sdp);
      await this.flushIce(existing);
      await existing.pc.setLocalDescription(await existing.pc.createAnswer());
      this.sendTo(from, { kind: "answer", sdp: existing.pc.localDescription!.toJSON() });
      return;
    }
    const link = this.createLink(from, existing?.name ?? (from === HOST ? "Terapist" : "Katılımcı"), existing?.memberId ?? null, false);
    await link.pc.setRemoteDescription(s.sdp);
    await this.flushIce(link);
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    this.sendTo(from, { kind: "answer", sdp: link.pc.localDescription!.toJSON() });
  }

  private async flushIce(l: Link) {
    for (const c of l.pendingIce.splice(0)) await l.pc.addIceCandidate(c).catch(() => {});
  }

  /** `from` ile (yeniden) bağlantı kurar; offerer ise offer gönderir. */
  private async connect(id: string, name: string, member: string | null, offerer: boolean) {
    const link = this.createLink(id, name, member, offerer);
    if (offerer) {
      if (this.role === "host" || id === HOST) {
        link.dc = link.pc.createDataChannel("control");
        this.wireChannel(link, link.dc);
        link.live = link.pc.createDataChannel("live");
        this.wireChannel(link, link.live);
      }
      await link.pc.setLocalDescription(await link.pc.createOffer());
      this.sendTo(id, { kind: "offer", sdp: link.pc.localDescription!.toJSON() });
    }
  }

  private createLink(id: string, name: string, member: string | null, offerer: boolean): Link {
    this.drop(id, false);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    const link: Link = { id, name, memberId: member, pc, dc: null, live: null, offerer, pendingIce: [], stream: null, state: "connecting", timer: null };
    this.links.set(id, link);
    for (const t of this.localStream.getTracks()) pc.addTrack(t, this.localStream);
    pc.onicecandidate = (e) => e.candidate && this.sendTo(id, { kind: "ice", candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      try {
        (e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null }).jitterBufferTarget = 0;
      } catch {
        /* desteklenmiyorsa varsayılan */
      }
      link.stream = e.streams[0] ?? new MediaStream([e.track]);
      this.emit();
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label === "live") link.live = e.channel;
      else link.dc = e.channel;
      this.wireChannel(link, e.channel);
    };
    pc.onconnectionstatechange = () => this.onLinkState(link);
    this.emit();
    return link;
  }

  private wireChannel(link: Link, ch: RTCDataChannel) {
    ch.onmessage = (ev) => {
      let m: ChannelMessage;
      try {
        m = JSON.parse(ev.data) as ChannelMessage;
      } catch {
        return;
      }
      this.h.onMessage?.(m, link.id);
      // Tuval herkes için ortak: terapist, bir danışandan geleni diğer danışanlara iletir.
      if (this.role === "host" && m.type.startsWith("board_")) this.sendMessage(m, undefined, link.id);
    };
  }

  private onLinkState(link: Link) {
    if (this.closed || this.links.get(link.id) !== link) return;
    const st = link.pc.connectionState;
    if (st === "connected") {
      if (link.timer) clearTimeout(link.timer);
      link.timer = null;
      link.state = "connected";
      this.emit();
      void this.applyBitrates();
      return;
    }
    if (st !== "disconnected" && st !== "failed") return;
    link.state = st === "failed" ? "failed" : "reconnecting";
    this.emit();
    if (link.timer) return;
    if (link.offerer) {
      // Offer veren taraf yeni ağ yolu arar (ICE restart); bağlantı dönene kadar tekrarlar.
      const attempt = async () => {
        link.timer = null;
        if (this.closed || this.links.get(link.id) !== link || link.pc.connectionState === "connected") return;
        if (link.pc.signalingState === "stable") {
          await link.pc.setLocalDescription(await link.pc.createOffer({ iceRestart: true })).catch(() => {});
          this.sendTo(link.id, { kind: "offer", sdp: link.pc.localDescription!.toJSON(), restart: true });
        }
        link.timer = setTimeout(() => void attempt(), RESTART_RETRY_MS);
      };
      link.timer = setTimeout(() => void attempt(), st === "failed" ? 0 : RESTART_AFTER_MS);
    } else {
      // Offer alan taraf: düzelmezse karşıdan baştan kurmasını ister.
      link.timer = setTimeout(() => {
        link.timer = null;
        if (this.links.get(link.id) === link && link.pc.connectionState !== "connected") {
          this.sendTo(link.id, { kind: "hello", name: this.me.name, member: this.me.member, reply: true });
        }
      }, REBUILD_AFTER_MS);
    }
  }

  private drop(id: string, notify = true) {
    const l = this.links.get(id);
    if (!l) return;
    if (l.timer) clearTimeout(l.timer);
    l.dc?.close();
    l.live?.close();
    l.pc.onconnectionstatechange = null;
    l.pc.close();
    this.links.delete(id);
    if (notify) this.emit();
  }

  private emit() {
    this.h.onPeers(this.peers);
    const connected = [...this.links.values()].some((l) => l.state === "connected");
    const hostLink = this.links.get(HOST);
    if (this.role === "host") this.h.onState(connected ? "connected" : this.links.size ? "connecting" : "waiting");
    else this.h.onState(hostLink?.state === "connected" ? "connected" : hostLink?.state === "reconnecting" ? "reconnecting" : "connecting");
  }

  // ── gönderim yardımcıları ──

  private dataTargets(to?: string, except?: string): Link[] {
    const all = [...this.links.values()];
    if (this.role === "guest") return all.filter((l) => l.id === HOST);
    return all.filter((l) => l.id !== except && (!to || l.id === to));
  }

  private async bufferedSend(l: Link, m: ChannelMessage): Promise<boolean> {
    const dc = l.dc;
    if (dc?.readyState !== "open") return false;
    if (dc.bufferedAmount > 1024 * 1024) {
      dc.bufferedAmountLowThreshold = 256 * 1024;
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
    if (dc.readyState !== "open") return false;
    dc.send(JSON.stringify(m));
    return true;
  }

  /** Bağlantı sayısına göre kişi başı bit hızı: toplam yükleme sabit, bağlantılar arasında bölünür. */
  private async applyBitrates() {
    const n = Math.max(1, this.links.size);
    const camBitrate = Math.round(Math.min(1_200_000, Math.max(200_000, 2_400_000 / n)));
    const scale = n >= 4 ? 2 : n >= 2 ? 1.5 : 1;
    const fps = n >= 4 ? 15 : 24;
    for (const l of this.links.values()) {
      for (const sender of l.pc.getSenders()) {
        if (!sender.track) continue;
        const p = sender.getParameters();
        const enc = p.encodings?.[0];
        if (!enc) continue;
        if (sender.track.kind === "audio") {
          enc.maxBitrate = 48_000;
          enc.priority = "high";
          enc.networkPriority = "high";
        } else if (this.videoProfile === "screen") {
          enc.maxBitrate = Math.round(Math.min(2_000_000, 4_000_000 / n));
          enc.maxFramerate = 15;
          enc.scaleResolutionDownBy = 1;
          p.degradationPreference = "maintain-resolution";
        } else {
          enc.maxBitrate = camBitrate;
          enc.maxFramerate = fps;
          enc.scaleResolutionDownBy = scale;
          p.degradationPreference = "maintain-framerate";
        }
        await sender.setParameters(p).catch(() => {});
      }
    }
  }
}
