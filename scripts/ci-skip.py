#!/usr/bin/env python3
"""무인 CI 의 무거운 단계를 **입력이 지난번과 똑같을 때만** 건너뛴다 (2026-10-25).

## 왜

data-refresh 의 2단계(rest)가 21분 걸렸는데, 그날 실제로 바뀐 건 펭귄 드랍률 소수점 몇 개였다
(실행 40093223656). 게임 표는 그대로인데 위기협약 색인(4.2분)·인프라(3.6분)·플래너 회귀검증
(5~10분)을 매번 처음부터 다시 돌고 있었다. 이 셋은 게임 표·코드·규칙이 같으면 결과도 같다.

## 어떻게 — 입력 목록을 사람이 적지 않는다

입력 목록을 손으로 적어 두면 누가 스크립트에 새 입력을 붙이는 순간 조용히 틀린다. 그래서
**실제로 돌 때 무엇을 읽었는지를 기록**한다:

- 파이썬 빌더는 이 스크립트 안에서 그대로 실행하면서(runpy) 감사 훅(sys.addaudithook)으로
  연 파일·훑은 폴더·존재 확인(os.stat)·지운 파일·네트워크 요청을 전부 잡는다.
  가져온(import) 모듈 소스도 파일 열기로 잡히므로 코드 변경도 입력이다.
  · 빌더가 **쓰기 전에** 읽은 파일 = 입력 → 그때의 내용 해시
  · 빌더가 쓴 파일 = 출력 → 끝난 뒤 내용 해시
  · 쓰기 전에 존재만 확인한 경로 = 입력 → 있었나/없었나·파일/폴더만
- 노드 단계(verify-plan)는 esbuild 메타파일로 번들 입력 목록을 그대로 얻는다.

다음 실행에서 아래가 **전부** 같을 때만 건너뛴다. 하나라도 다르면(또는 기록이 없으면) 그냥 돈다.
  1. 명령·파이썬/노드·UnityPy·lz4inv·Pillow·flatc·esbuild 버전
  2. 입력 파일 내용(app/data/*.json 은 맨 위 `updated` 날짜만 빼고 비교)·존재 여부·폴더 목록
  3. 출력 파일이 기록된 그대로다 — 커밋된 산출물을 누가(사람·다른 단계) 고쳤으면 다시 돈다.
     빌더가 자기 이전 출력을 읽는다면(위기협약의 카메라 유지) 입력=출력이 같아진 뒤에만 건너뛴다.
  4. 게임 CDN 에 물었다면 네 서버 resVersion 이 같다 (번들 내용은 resVersion 이 정한다)
  5. 그 밖의 URL(카메라 원본 등)은 지금 HEAD 로 다시 물어 ETag·Last-Modified 가 같다
     — 검증 수단이 없는 요청(POST, 검증자 없는 응답, 정체 모를 접속)이 하나라도 있었으면 영영 안 건너뛴다.

기록은 `.ci/input-hashes.json` 에 둔다 — `.ci/resversion.json` 처럼 레포에 커밋한다.
러너 캐시는 조용히 비워지고, 커밋해 두면 산출물과 **같은 커밋**에 실려 서로 어긋날 수 없다.

## 안전장치

- **로컬에서는 아무것도 안 한다** — GITHUB_ACTIONS 가 없으면 빌더를 그대로 exec 한다. 기록도 안 쓴다.
- 건너뛰기는 워크플로가 `CI_SKIP_UNCHANGED=1` 을 줄 때만. 하루 한 번(04:00 UTC)·수동 `full` 실행은 0 →
  전부 돌고 기록만 새로 쓴다 (시각에 따라 바뀌는 외부 원본이 있어도 하루 넘게 묵지 않게).
- 1단계(fast)가 CDN 수신에 성공했다는 표식(`.gamedata/.ci-fetch.json`)이 없으면 건너뛰지 않는다.
- 빌더가 실패하면(종료 코드 ≠ 0) 기록을 남기지 않는다.

⚠ 여기 물리는 빌더는 **현재 시각에 따라 결과가 달라지면 안 된다** (datetime.now 등은 못 잡는다).
  지금 물린 build-infra · build-stages-crisis 는 확인했다 (fromtimestamp 만 쓴다).
⚠ build-enemies 는 물리지 않는다 — 출력 enemy-stages*.json 을 뒤 단계(build-enemy-stages-extra)가
  고쳐 쓰므로 3번 조건이 늘 깨지고, .gamedata/levels 캐시를 뒤 단계가 읽을 수도 있다.

사용:
  python3 scripts/ci-skip.py run  <이름> -- scripts/build-x.py [인자…]
  python3 scripts/ci-skip.py node <이름> --esbuild a.ts,b.ts [--also f1,f2] -- node scripts/x.mjs [인자…]
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request

V = 1
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(REPO, ".ci", "input-hashes.json")
MARK = os.path.join(REPO, ".gamedata", ".ci-fetch.json")
IN_CI = bool(os.environ.get("GITHUB_ACTIONS"))
MAX_URLS = 200


def say(msg):
    print(msg, flush=True)
    summ = os.environ.get("GITHUB_STEP_SUMMARY")
    if summ:
        try:
            with open(summ, "a", encoding="utf-8") as f:
                f.write("- " + msg.strip() + "\n")
        except OSError:
            pass


# ── 경로·해시 ────────────────────────────────────────────────────────────────
def rel(path):
    """감시 대상이면 레포 기준 상대경로, 아니면 None."""
    if isinstance(path, bytes):
        path = os.fsdecode(path)
    if not isinstance(path, str) or not path:
        return None
    p = os.path.abspath(path)
    if not p.startswith(REPO + os.sep):
        return None
    r = os.path.relpath(p, REPO).replace(os.sep, "/")
    if r.startswith((".git/", "node_modules/")) or "/__pycache__/" in "/" + r:
        # 바이트코드(.pyc)는 원본 .py 로 바꿔 센다 — 로컬엔 캐시가 있고 러너엔 없다
        if r.endswith(".pyc") and "__pycache__/" in r:
            d, f = r.split("__pycache__/", 1)
            return d + f.split(".", 1)[0] + ".py"
        return None
    if r in (".ci/input-hashes.json", ".gamedata/.ci-fetch.json"):
        return None
    return r


def _sha(b):
    return hashlib.sha256(b).hexdigest()[:24]


def content(r):
    """파일 내용 해시. app/data/*.json 은 맨 위 `updated`(날짜 도장)를 빼고 센다."""
    p = os.path.join(REPO, r)
    with open(p, "rb") as f:
        b = f.read()
    if r.startswith("app/data/") and r.endswith(".json"):
        try:
            o = json.loads(b)
            if isinstance(o, dict) and "updated" in o:
                o = dict(o)
                o.pop("updated")
                b = json.dumps(o, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except ValueError:
            pass
    return _sha(b)


def state(r, kind):
    """kind: c(내용) · x(존재·종류) · l(폴더 목록)."""
    p = os.path.join(REPO, r)
    if os.path.isfile(p):
        return "f:" + content(r) if kind == "c" else "f"
    if os.path.isdir(p):
        return "d:" + _sha("\n".join(sorted(os.listdir(p))).encode("utf-8")) if kind == "l" else "d"
    return "-"


# ── 환경 지문 ────────────────────────────────────────────────────────────────
def _pkg(name):
    try:
        from importlib import metadata
        return metadata.version(name)
    except Exception:  # noqa: BLE001
        return "-"


def _cmd_out(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=30).stdout.strip() or "-"
    except Exception:  # noqa: BLE001
        return "-"


def env_python():
    return {"python": "%d.%d" % sys.version_info[:2], "UnityPy": _pkg("UnityPy"), "lz4inv": _pkg("lz4inv"),
            "Pillow": _pkg("Pillow"), "flatc": _cmd_out(["flatc", "--version"])}


def env_node():
    try:
        eb = json.load(open(os.path.join(REPO, "node_modules", "esbuild", "package.json"))).get("version", "-")
    except Exception:  # noqa: BLE001
        eb = "-"
    return {"node": _cmd_out(["node", "--version"]), "esbuild": eb}


# ── 게임 CDN 수신 표식 (ci-refresh.sh 가 남긴다) ─────────────────────────────
def mark():
    try:
        m = json.load(open(MARK, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    if not m.get("cdn_ok") or not isinstance(m.get("res"), dict) or len(m["res"]) < 4:
        return None
    if IN_CI and m.get("run") != "%s-%s" % (os.environ.get("GITHUB_RUN_ID"), os.environ.get("GITHUB_RUN_ATTEMPT", "1")):
        return None
    return m


# ── 외부 URL 검증자 ──────────────────────────────────────────────────────────
def validator(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "terra-archive-ci-skip/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            st, h = r.status, r.headers
    except urllib.error.HTTPError as e:
        st, h = e.code, e.headers
    et, lm = h.get("ETag"), h.get("Last-Modified")
    if not et and not lm and st < 400:
        raise ValueError("검증자(ETag·Last-Modified) 없음")
    return "%s|%s|%s|%s" % (st, et or "", lm or "", h.get("Content-Length") or "")


def validators(urls):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(8) as ex:
        return dict(zip(urls, ex.map(validator, urls)))


# ── 기록 ─────────────────────────────────────────────────────────────────────
def load_store():
    try:
        s = json.load(open(STORE, encoding="utf-8"))
        return s if s.get("v") == V else {"v": V, "steps": {}}
    except Exception:  # noqa: BLE001
        return {"v": V, "steps": {}}


def save_record(label, rec):
    s = load_store()
    s.setdefault("steps", {})[label] = rec
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    with open(STORE, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")


def why_not_skip(label, cmd, env):
    """건너뛸 수 있으면 None, 아니면 이유(한 줄)."""
    if os.environ.get("CI_SKIP_UNCHANGED") != "1":
        return "정기 전체 실행 (CI_SKIP_UNCHANGED≠1)"
    m = mark()
    if not m:
        return "이번 실행의 CDN 수신 표식이 없다 (레포 폴백·수신 실패)"
    rec = load_store()["steps"].get(label)
    if not rec:
        return "기록 없음"
    if rec.get("unskippable"):
        return "지난 실행이 검증할 수 없는 입력을 썼다 — " + rec["unskippable"]
    if rec.get("cmd") != cmd:
        return "명령이 바뀌었다"
    if rec.get("env") != env:
        return "도구 버전이 바뀌었다"
    for srv, v in (rec.get("res") or {}).items():
        if m["res"].get(srv) != v:
            return "%s resVersion %s → %s" % (srv, v, m["res"].get(srv))
    for key, want in sorted((rec.get("in") or {}).items()):
        kind, r = key.split(":", 1)
        if state(r, kind) != want:
            return "입력이 바뀌었다: " + r
    for r, want in sorted((rec.get("out") or {}).items()):
        if state(r, "c") != want:
            return "출력이 기록과 다르다: " + r
    net = rec.get("net") or {}
    if net:
        try:
            now = validators(sorted(net))
        except Exception as e:  # noqa: BLE001
            return "외부 URL 확인 실패 (%s)" % str(e)[:60]
        for u in sorted(net):
            if now.get(u) != net[u]:
                return "외부 원본이 바뀌었다: " + u[:80]
    return None


# ── 파이썬 빌더: 감사 훅으로 추적하며 실행 ───────────────────────────────────
class Tracer:
    def __init__(self):
        self.on = False
        self.lock = threading.RLock()
        self.tl = threading.local()
        self.inputs = {}      # "kind:path" → state (빌더가 쓰기 전 모습)
        self.written = set()  # 빌더가 쓰거나 지운 경로
        self.urls = {}        # url → method
        self.hosts = set()    # getaddrinfo 로 물은 호스트

    def _guard(fn):  # noqa: N805 — 훅 안에서 파일을 열면 훅이 다시 불린다
        def w(self, *a):
            if not self.on or getattr(self.tl, "busy", False):
                return
            self.tl.busy = True
            try:
                with self.lock:
                    fn(self, *a)
            except Exception as e:  # noqa: BLE001 — 추적 실패가 빌더를 죽이면 안 된다
                self.inputs["!:" + type(e).__name__] = str(e)[:80]
            finally:
                self.tl.busy = False
        return w

    def _input(self, kind, r):
        if r is None or r in self.written:
            return
        if kind == "l" and any(w.startswith(r.rstrip("/") + "/") for w in self.written):
            return   # 빌더가 이미 뭔가 써 넣은 폴더의 목록은 입력이 아니다
        key = kind + ":" + r
        if key not in self.inputs:
            self.inputs[key] = state(r, kind)

    @_guard
    def hook(self, event, args):
        if event == "open":
            path, mode, flags = args[0], args[1], args[2]
            r = rel(path)
            if r is None:
                return
            if isinstance(mode, str):
                wr = any(c in mode for c in "wax+")
            else:
                wr = bool((flags or 0) & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
            if wr:
                self.written.add(r)
            else:
                self._input("c", r)
        elif event in ("os.listdir", "os.scandir"):
            self._input("l", rel(args[0] if args and args[0] is not None else "."))
        elif event in ("os.remove", "os.rmdir", "shutil.rmtree"):
            r = rel(args[0])
            if r:
                self.written.add(r)
        elif event in ("os.rename", "os.replace"):
            for p in args[:2]:
                r = rel(p)
                if r:
                    self.written.add(r)
        elif event == "urllib.Request":
            url, data, method = args[0], args[1], args[3] if len(args) > 3 else None
            self.urls[url] = (method or ("POST" if data is not None else "GET")).upper()
        elif event == "socket.getaddrinfo":
            if isinstance(args[0], (str, bytes)):
                self.hosts.add(args[0].decode() if isinstance(args[0], bytes) else args[0])

    @_guard
    def stat(self, path):
        self._input("x", rel(path))


def cdn_conns():
    """빌더가 띄운 게임 CDN 연결들 — 모듈마다 `_cdn = {서버: Cdn}` 로 들고 있다."""
    out = []
    for mod in list(sys.modules.values()):
        f = getattr(mod, "__file__", None) or ""
        d = getattr(mod, "_cdn", None)
        if f.startswith(REPO) and isinstance(d, dict):
            for srv, c in d.items():
                if hasattr(c, "res_version"):
                    out.append((srv, c))
    return out


def run_python(label, script, args):
    cmd = [script] + list(args)
    if not IN_CI:
        os.execvp(sys.executable, [sys.executable] + cmd)
    env = env_python()
    why = why_not_skip(label, cmd, env)
    if why is None:
        say("  ↷ %s 건너뜀 — 입력(게임 표·코드·규칙·CDN 버전)이 지난 실행과 같고 출력도 그대로다" % label)
        return 0
    say("  ↻ %s 실행 — %s" % (label, why))

    t = Tracer()
    real_stat = os.stat

    def traced_stat(path, *a, **k):
        t.stat(path)
        return real_stat(path, *a, **k)

    sys.addaudithook(t.hook)
    os.stat = traced_stat
    sys.argv = [script] + list(args)
    import runpy
    code = 0
    t.on = True
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        if not isinstance(e.code, int) and e.code is not None:
            print(e.code, file=sys.stderr)
    finally:
        t.on = False
        os.stat = real_stat
    sys.stdout.flush()
    if code != 0:
        return code

    try:
        record(label, cmd, env, t)
    except Exception as e:  # noqa: BLE001 — 기록 실패는 다음에 그냥 다시 돌 뿐이다
        say("  ⚠ %s 입력 기록 실패 (%s) — 다음 실행은 건너뛰지 않는다" % (label, str(e)[:80]))
    return 0


def record(label, cmd, env, t):
    bad = []
    if any(k.startswith("!:") for k in t.inputs):
        bad.append("추적 오류 " + ", ".join(k[2:] for k in t.inputs if k.startswith("!:")))
    m = mark() or {}
    conns = cdn_conns()
    res = {}
    covered = []
    for srv, c in conns:
        res[srv] = c.res_version
        if m.get("res", {}).get(srv) != c.res_version:
            bad.append("CDN %s 버전이 수신 때와 다르다" % srv)
        covered.append(getattr(c, "assets", None))
        hv = (getattr(c, "urls", None) or {}).get("hv")
        if hv:
            covered.append(hv.split("{0}")[0])
    try:
        import fbsutil  # 서버별 network_config 주소
        covered += list(getattr(fbsutil, "CONF", {}).values())
    except Exception:  # noqa: BLE001
        pass
    covered = [c for c in covered if c]
    external = []
    for url, method in sorted(t.urls.items()):
        if any(url.startswith(c) for c in covered):
            continue
        if method not in ("GET", "HEAD"):
            bad.append("%s 요청 %s" % (method, url[:60]))
        else:
            external.append(url)
    url_hosts = {urllib.parse.urlsplit(u).hostname for u in t.urls}
    stray = sorted(h for h in t.hosts if h not in url_hosts)
    if stray:
        bad.append("정체 모를 접속 " + ", ".join(stray[:3]))
    net = {}
    if len(external) > MAX_URLS:
        bad.append("외부 URL %d개 (확인 한도 %d)" % (len(external), MAX_URLS))
    elif external and not bad:
        try:
            net = validators(external)
        except Exception as e:  # noqa: BLE001
            bad.append("외부 URL 검증자 없음 (%s)" % str(e)[:60])
    out = {}
    for r in sorted(t.written):
        if r.startswith(".gamedata/"):
            continue   # 러너마다 새로 생기는 캐시 — 같은 resVersion 이면 같은 내용이다
        out[r] = state(r, "c")
    rec = {"cmd": cmd, "env": env, "res": res if conns else None,
           "in": {k: v for k, v in sorted(t.inputs.items()) if not k.startswith("!:")},
           "out": out, "net": net, "unskippable": "; ".join(bad) or None}
    save_record(label, rec)
    say("  ✎ %s 입력 기록 — 입력 %d · 출력 %d · 외부 URL %d%s"
        % (label, len(rec["in"]), len(out), len(net), (" · ⚠ 건너뛰기 불가: " + rec["unskippable"]) if bad else ""))


# ── 노드 단계 (verify-plan): esbuild 메타파일이 입력 목록이다 ────────────────
def run_node(label, entries, also, cmd):
    if not IN_CI:
        os.execvp(cmd[0], cmd)
    env = env_node()
    with tempfile.TemporaryDirectory() as td:
        meta = os.path.join(td, "meta.json")
        subprocess.run([os.path.join(REPO, "node_modules", ".bin", "esbuild"), *entries, "--bundle", "--format=esm",
                        "--platform=node", "--outdir=" + td, "--metafile=" + meta, "--log-level=error"],
                       cwd=REPO, check=True)
        files = sorted(set(json.load(open(meta, encoding="utf-8"))["inputs"]) | set(also))
    ins = {}
    for f in files:
        r = rel(os.path.join(REPO, f))
        if r:
            ins["c:" + r] = state(r, "c")
    why = why_not_skip(label, cmd, env)
    if why is None:
        stored = load_store()["steps"].get(label) or {}
        if set(stored.get("in") or {}) != set(ins):
            why = "입력 목록이 바뀌었다"
    if why is None:
        say("  ↷ %s 건너뜀 — 엔진·인프라 데이터·규칙(입력 %d개)이 지난번 통과 때와 같다" % (label, len(ins)))
        return 0
    say("  ↻ %s 실행 — %s" % (label, why))
    code = subprocess.run(cmd, cwd=REPO).returncode
    if code == 0:
        save_record(label, {"cmd": cmd, "env": env, "res": None, "in": ins, "out": {}, "net": {}, "unskippable": None})
        say("  ✎ %s 통과 기록 — 입력 %d개" % (label, len(ins)))
    return code


def main(argv):
    if len(argv) < 4 or "--" not in argv:
        sys.exit(__doc__.split("사용:")[1])
    mode, label = argv[1], argv[2]
    sep = argv.index("--")
    opts, cmd = argv[3:sep], argv[sep + 1:]
    if mode == "run":
        return run_python(label, cmd[0], cmd[1:])
    if mode == "node":
        o = dict(zip(opts[::2], opts[1::2]))
        entries = [x for x in o.get("--esbuild", "").split(",") if x]
        also = [x for x in o.get("--also", "").split(",") if x]
        if not entries:
            sys.exit("--esbuild 가 필요하다")
        return run_node(label, entries, also, cmd)
    sys.exit("모드는 run|node")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
