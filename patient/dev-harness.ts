// Geliştirici testi: sahte kamera/mikrofon akışıyla rtc.ts'i iki uçtan dener.
//   Terapist: /dev-harness.html?role=host
//   Danışan:  verilen bağlantı (farklı origin, ör. 127.0.0.1) — ayrı anonim kimlik için.
import { Call, createInvite, joinRoom } from "../src/lib/rtc";

const log = (m: string) => {
  const el = document.getElementById("log")!;
  el.textContent += `${new Date().toLocaleTimeString()} ${m}\n`;
  (window as any).__log = el.textContent;
};

function fakeStream(color: string): MediaStream {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 180;
  const g = c.getContext("2d")!;
  let t = 0;
  setInterval(() => {
    g.fillStyle = color;
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = "#fff";
    g.fillRect((t += 4) % 320, 80, 20, 20);
  }, 33);
  const v = c.captureStream(30);
  const ac = new AudioContext();
  const osc = ac.createOscillator();
  const dst = ac.createMediaStreamDestination();
  osc.connect(dst);
  osc.start();
  return new MediaStream([...v.getVideoTracks(), ...dst.stream.getAudioTracks()]);
}

const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const w = window as any;

async function main() {
  const handlers = {
    onState: (s: string) => {
      w.__state = s;
      log(`state=${s}`);
    },
    onRemoteStream: (s: MediaStream | null) => {
      (document.getElementById("remote") as HTMLVideoElement).srcObject = s;
      w.__remoteTracks = s ? s.getTracks().map((t) => t.kind).join(",") : "";
      log(`remote=${w.__remoteTracks || "none"}`);
    },
    onStats: (s: unknown) => {
      w.__stats = s;
    },
    onMessage: (m: unknown) => {
      w.__msg = m;
      log(`msg=${JSON.stringify(m)}`);
    },
  };

  if (params.get("role") === "host") {
    document.getElementById("role")!.textContent = "TERAPİST (test)";
    const inv = await createInvite(params.get("base") ?? "http://127.0.0.1:5174/dev-harness.html", 10);
    w.__link = inv.link;
    log(`link=${inv.link}`);
    const call = new Call("host", inv.room, fakeStream("#3b2f8f"), handlers);
    w.__call = call;
    await call.start();
  } else {
    document.getElementById("role")!.textContent = "DANIŞAN (test)";
    const room = hash.get("r")!;
    const token = hash.get("t")!;
    const r = await joinRoom(room, token);
    w.__join = r;
    log(`join=${r}`);
    if (r !== "ok") return;
    const call = new Call("guest", room, fakeStream("#14532d"), handlers);
    w.__call = call;
    await call.start();
  }
}

main().catch((e) => {
  w.__error = String(e);
  log(`HATA: ${e}`);
});
