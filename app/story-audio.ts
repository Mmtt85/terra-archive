"use client";

// 리더기 소리 — 대본의 BGM·효과음을 Web Audio 로 재생한다 (2026-09-27, 사용자 요청
// "스토리 리더기에 BGM이랑 효과음 찾아서 다 넣어줘"). story-vn.tsx 만 부른다 (리더기 청크에만 실린다).
//
// 데이터: 스크립트 JSON 의 `au` 트랙 (scripts/build-story-scripts.py parse_story) — 소리가 바뀐 줄에만
//   스냅샷이 있다. m/mi/mv/lp 는 **상태**(지금 울려야 할 곡·반복음), se 는 그 줄에서 **한 번** 울리는 효과음.
// 파일: /story/audio/<이름>.mp3 + index.json (scripts/build-story-audio.py). 색인에 없는 이름은 부르지 않는다.
//
// ⚠ <audio loop> 가 아니라 Web Audio 인 이유 — 루프 이음매. <audio> 는 되감을 때마다 틈이 생기고
//   MP3 앞뒤 인코더 여백까지 들어가 곡이 2분마다 툭 끊긴다. AudioBufferSourceNode 의 loopStart/loopEnd 는
//   샘플 단위로 잇는다. 인트로 → 루프도 AudioContext 시계로 맞물려 예약한다.
// ⚠ 파일 앞뒤엔 색인의 pad(0.05초)만큼 덧댐이 있고, 브라우저마다 MP3 앞 지연을 다르게 먹는다
//   (2026-09-27 실측: 크로미움 1,105샘플 · 웹킷 576샘플, 디코딩 길이는 같다). 그래서 시작점을
//   **늦은 쪽(LEAD)** 으로 잡는다 — 오차가 늘 +쪽이 되고, 빌드가 덧댄 내용(루프는 곡의 반대쪽 끝,
//   인트로는 이어질 루프의 머리)이 그 틈을 진짜 다음 소리로 메운다.
// ⚠ 소리는 **사용자 조작 안에서만** 켤 수 있다 (자동재생 정책). 리더기를 누르거나 키를 칠 때 unlock() —
//   그 전에 apply() 된 상태는 기억해 뒀다가 풀리는 순간 튼다.
import { asset } from "./assets";

/** 효과음 한 번 — [파일 이름, 음량(기본 1), 지연 초(기본 0)] */
export type AuSe = [string, number?, number?];
/** 소리 스냅샷 — i = 이 소리 상태가 처음 적용되는 줄 번호 */
export type AuSnap = {
  i: number;
  m?: string;                               // 루프 곡
  mi?: string;                              // 그 앞에 한 번 흐르는 인트로
  mv?: number;                              // 곡 음량 (기본 1)
  lp?: Record<string, [string, number]>;    // 채널 → [반복음, 음량]
  se?: AuSe[];
};

type Index = { pad: number; a: Record<string, [number, unknown]> };
type Voice = { id: string; gain: GainNode; srcs: AudioBufferSourceNode[]; vol: number };

const LEAD = 1105 / 44100;   // MP3 앞 지연의 늦은 쪽 (크로미움)
const FADE_OUT = 1;          // 곡·반복음이 바뀌거나 멈출 때 (대본의 crossfade·fadetime 은 대개 1~2초)
const FADE_IN = 0.6;
const MUSIC_KEEP = 3;        // 풀어 둔 곡 버퍼 — 2분짜리 스테레오 한 곡이 40MB 남짓이라 많이 쥐지 않는다
const SFX_KEEP = 60;
const LATE_SE = 1.2;         // 효과음이 이만큼 늦게 받아지면 버린다 (그 장면은 이미 지나갔다)

class StoryAudio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private index: Promise<Index | null> | null = null;
  private idx: Index | null = null;
  private bytes = new Map<string, Promise<ArrayBuffer | null>>();   // 풀기 전(소리가 아직 안 풀렸을 때 미리 받은 것)
  private bufs = new Map<string, Promise<AudioBuffer | null>>();   // 삽입 순서 = 최근 사용 순 (LRU)
  private music: Voice | null = null;
  private loops = new Map<string, Voice>();
  private sfx = new Set<AudioBufferSourceNode>();
  private want: AuSnap | null = null;
  private vol = 0.6;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private loadIndex(): Promise<Index | null> {
    if (!this.index) {
      this.index = fetch(asset("/story/audio/index.json"))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((d: Index | null) => { this.idx = d; return d; });
    }
    return this.index;
  }

  private has(id: string | undefined): id is string {
    return !!id && !!this.idx?.a[id];
  }

  /** 사용자 조작 안에서 부른다 — 컨텍스트를 만들거나 깨운 뒤 기억해 둔 상태를 튼다. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.vol;
      this.out.connect(this.ctx.destination);
      // 탭을 숨기면 재운다 — 게임도 앱을 내리면 소리가 멎는다
      document.addEventListener("visibilitychange", () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else if (this.want) void this.ctx.resume().then(() => this.sync());
      });
    }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.ctx.state !== "running" && !document.hidden) void this.ctx.resume().then(() => this.sync());
    else this.sync();
  }

  setVolume(v: number): void {
    this.vol = v;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  /** 지금 줄의 소리 상태를 건다. fire = 그 줄의 효과음까지 울린다 (줄을 막 넘어왔을 때만). */
  apply(snap: AuSnap | null, fire: boolean): void {
    this.want = snap;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    void this.loadIndex().then(() => {
      if (this.want !== snap) return;
      this.sync();
      if (fire && snap?.se && this.ctx?.state === "running") this.fire(snap.se);
    });
  }

  /** 곧 쓸 소리를 미리 받아 둔다 (다음 몇 줄치). 풀리기 전이면 내려받기만 한다. */
  prefetch(ids: string[]): void {
    void this.loadIndex().then(() => {
      for (const id of ids) {
        if (!this.has(id) || this.bufs.has(id) || this.bytes.has(id)) continue;
        if (this.ctx) void this.load(id);
        else if (this.bytes.size < 24) this.bytes.set(id, this.download(id));
      }
    });
  }

  /** 전부 멈춘다 (소리 끄기·리더기를 벗어날 때). 잠시 뒤 컨텍스트도 재운다 — 배터리. */
  silence(): void {
    this.want = null;
    if (!this.ctx) return;
    if (this.music) { this.stop(this.music, 0.4); this.music = null; }
    for (const v of this.loops.values()) this.stop(v, 0.4);
    this.loops.clear();
    for (const s of this.sfx) { try { s.stop(); } catch { /* 이미 끝남 */ } }
    this.sfx.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.want && this.ctx?.state === "running") void this.ctx.suspend();
    }, 800);
  }

  // ── 내부 ──────────────────────────────────────────────────────────────────
  private download(id: string): Promise<ArrayBuffer | null> {
    return fetch(asset(`/story/audio/${id}.mp3`))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }

  private load(id: string): Promise<AudioBuffer | null> {
    const hit = this.bufs.get(id);
    if (hit) {                       // 최근 사용으로 올린다
      this.bufs.delete(id);
      this.bufs.set(id, hit);
      return hit;
    }
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    const pre = this.bytes.get(id);
    this.bytes.delete(id);
    const p = (pre ?? this.download(id))
      .then((ab) => (ab ? ctx.decodeAudioData(ab) : null))
      .catch(() => null);
    this.bufs.set(id, p);
    this.trim();
    return p;
  }

  /** 오래 안 쓴 버퍼를 놓는다 — 지금 울리는 것은 남긴다. 20초 넘는 것을 곡으로 친다. */
  private trim(): void {
    const busy = new Set<string>();
    if (this.music) busy.add(this.music.id);
    for (const v of this.loops.values()) busy.add(v.id);
    let music = 0, sfx = 0;
    for (const id of [...this.bufs.keys()].reverse()) {
      const big = (this.idx?.a[id]?.[0] ?? 0) > 20;
      const n = big ? ++music : ++sfx;
      if (!busy.has(id) && n > (big ? MUSIC_KEEP : SFX_KEEP)) this.bufs.delete(id);
    }
  }

  /** 파일 안에서 원래 소리가 있는 구간 [시작, 길이] — 앞뒤 덧댐을 뺀다 (머리말 주석) */
  private region(id: string, buf: AudioBuffer): [number, number] {
    const dur = this.idx?.a[id]?.[0] ?? buf.duration;
    const start = Math.max(0, Math.min((this.idx?.pad ?? 0) + LEAD, buf.duration - dur));
    return [start, Math.min(dur, buf.duration - start)];
  }

  private voice(id: string, vol: number): Voice {
    const gain = this.ctx!.createGain();
    gain.gain.value = 0;
    gain.connect(this.out!);
    return { id, gain, srcs: [], vol };
  }

  private fadeTo(v: Voice, to: number, sec: number): void {
    const t = this.ctx!.currentTime;
    const g = v.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + sec);
  }

  private stop(v: Voice, fade = FADE_OUT): void {
    if (!this.ctx) return;
    this.fadeTo(v, 0, fade);
    const end = this.ctx.currentTime + fade + 0.05;
    for (const s of v.srcs) { try { s.stop(end); } catch { /* 이미 멈춤 */ } }
    setTimeout(() => v.gain.disconnect(), (fade + 0.3) * 1000);
  }

  private async startMusic(loopId: string, introId: string | undefined, vol: number): Promise<void> {
    const v = this.voice(loopId, vol);
    this.music = v;
    const [lb, ib] = await Promise.all([this.load(loopId), introId ? this.load(introId) : null]);
    const ctx = this.ctx;
    if (this.music !== v || !lb || !ctx) { if (this.music === v) this.music = null; v.gain.disconnect(); return; }
    const t0 = ctx.currentTime + 0.05;
    let at = t0;
    if (ib && introId) {
      const [s0, d0] = this.region(introId, ib);
      const src = ctx.createBufferSource();
      src.buffer = ib;
      src.connect(v.gain);
      src.start(t0, s0, d0);
      v.srcs.push(src);
      at = t0 + d0;                  // 인트로가 끝나는 바로 그 샘플에 루프를 건다
    }
    const [s1, d1] = this.region(loopId, lb);
    const src = ctx.createBufferSource();
    src.buffer = lb;
    src.loop = true;
    src.loopStart = s1;
    src.loopEnd = s1 + d1;
    src.connect(v.gain);
    src.start(at, s1);
    v.srcs.push(src);
    v.gain.gain.setValueAtTime(0, t0);
    v.gain.gain.linearRampToValueAtTime(v.vol, t0 + FADE_IN);
  }

  private async startLoop(ch: string, id: string, vol: number): Promise<void> {
    const v = this.voice(id, vol);
    this.loops.set(ch, v);
    const buf = await this.load(id);
    const ctx = this.ctx;
    if (this.loops.get(ch) !== v || !buf || !ctx) { if (this.loops.get(ch) === v) this.loops.delete(ch); v.gain.disconnect(); return; }
    const [s, d] = this.region(id, buf);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = s;
    src.loopEnd = s + d;
    src.connect(v.gain);
    const t0 = ctx.currentTime + 0.02;
    src.start(t0, s);
    v.srcs.push(src);
    v.gain.gain.setValueAtTime(0, t0);
    v.gain.gain.linearRampToValueAtTime(v.vol, t0 + 0.4);
  }

  /** 바라는 상태(want)와 지금 울리는 것을 맞춘다. 같은 곡이면 끊지 않고 음량만 옮긴다. */
  private sync(): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.idx) return;
    const w = this.want;
    const loopId = this.has(w?.m) ? w!.m : undefined;
    const mv = w?.mv ?? 1;
    if (this.music && this.music.id !== loopId) { this.stop(this.music); this.music = null; }
    if (loopId && !this.music) void this.startMusic(loopId, this.has(w?.mi) ? w!.mi : undefined, mv);
    else if (this.music && this.music.vol !== mv) { this.music.vol = mv; this.fadeTo(this.music, mv, FADE_OUT); }

    const lp = w?.lp ?? {};
    for (const [ch, v] of [...this.loops]) {
      if (lp[ch]?.[0] !== v.id) { this.stop(v); this.loops.delete(ch); }
    }
    for (const [ch, [id, vol]] of Object.entries(lp)) {
      if (!this.has(id)) continue;
      const cur = this.loops.get(ch);
      if (!cur) void this.startLoop(ch, id, vol);
      else if (cur.vol !== vol) { cur.vol = vol; this.fadeTo(cur, vol, FADE_OUT); }
    }
  }

  private fire(list: AuSe[]): void {
    const ctx = this.ctx!;
    const asked = ctx.currentTime;
    for (const [id, vol = 1, delay = 0] of list) {
      if (!this.has(id)) continue;
      void this.load(id).then((buf) => {
        if (!buf || this.ctx !== ctx || ctx.state !== "running" || !this.want) return;
        const when = asked + delay;
        if (ctx.currentTime - when > LATE_SE) return;
        const [s, d] = this.region(id, buf);
        const g = ctx.createGain();
        g.gain.value = vol;
        g.connect(this.out!);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(g);
        src.onended = () => { g.disconnect(); this.sfx.delete(src); };
        this.sfx.add(src);
        src.start(Math.max(ctx.currentTime, when), s, d);
      });
    }
  }
}

export const storyAudio = new StoryAudio();

// ── 소리 설정 (켜기/끄기·음량) — localStorage 에 기억, 리더기가 여러 개여도 하나를 같이 본다 ──
// useSyncExternalStore 로 읽는다 — 서버·하이드레이션 스냅샷은 기본값이라 프리렌더와 갈리지 않는다.
export type SoundPref = { on: boolean; vol: number };
const SOUND_KEY = "story-reader-sound";
export const SOUND_DEFAULT: SoundPref = { on: true, vol: 0.6 };
let soundPref: SoundPref | null = null;
const listeners = new Set<() => void>();

export function getSound(): SoundPref {
  if (soundPref) return soundPref;
  soundPref = SOUND_DEFAULT;
  try {
    const p = JSON.parse(window.localStorage.getItem(SOUND_KEY) ?? "null");
    if (p && typeof p.on === "boolean" && typeof p.vol === "number") {
      soundPref = { on: p.on, vol: Math.min(1, Math.max(0, p.vol)) };
    }
  } catch { /* 저장소 막힘 — 기본값 */ }
  return soundPref;
}

export function setSound(next: SoundPref): void {
  soundPref = next;
  try { window.localStorage.setItem(SOUND_KEY, JSON.stringify(next)); } catch { /* 무시 */ }
  for (const fn of listeners) fn();
}

export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
