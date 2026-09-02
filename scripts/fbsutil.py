#!/usr/bin/env python3
"""명일방주 클라이언트 CDN 언팩 공용 모듈 — 핫업데이트 목록·.idx 매니페스트·FlatBuffer 정규화.

`fetch-gamedata-cdn.py`가 쓰는 뼈대. 클뜯 레포(ArknightsAssets)를 기다리지 않고
**게임이 실제로 받는 CDN에서 직접** gamedata 표를 받아 공식 JSON 모양으로 만든다.

## 데이터가 흐르는 길 (2026-09-02 실측으로 확정)

    ak-conf.<서버>/config/prod/official/network_config   ← 인증 없음, 공개
      → {hv}/Android/version                             → resVersion
      → {hu}/Android/assets/<resVersion>/hot_update_list.json
      → 번들 .dat (zip 한 겹) → Unity AssetBundle
      → UnityPy 로 TextAsset 추출
      → 앞 128바이트 RSA 서명 제거 → **평문 FlatBuffer** (암호화 아님)
      → flatc + .fbs 스키마 → JSON → normalize() → 공식 JSON 모양

⚠ 흔한 오해 두 가지 (둘 다 직접 시험해 아님을 확인했다):
  · "AES로 암호화돼 있다" — 아니다. 표가 JSON이던 옛 시절 유물이다.
    엔트로피가 5.6 bits/byte(암호문이면 8.0)이고 off=128부터 정상 FlatBuffer다.
  · "IPA를 뜯으면 된다" — 아니다. 앱 패키지에 gamedata가 거의 없다.
    첫 실행 때 이 CDN에서 통째로 내려받는다.

## flatc 산출물과 공식 JSON의 차이 (normalize 가 메우는 것)

    [dict__K__V]   맵      flatc: [{key,value}...]    공식: {k: v}
    [list_T]       중첩배열 flatc: [{values:[...]}...]  공식: [[...], ...]
    부재 필드               flatc: 생략                공식: null

⚠ `clz_Torappu_Blackboard_DataPair` 처럼 key/value 필드를 갖고 있지만 **맵이 아닌**
  테이블이 있다. 모양으로 넘겨짚어 접으면 blackboard 가 통째로 뭉개진다 —
  반드시 스키마 타입(`dict__` 접두사)으로 판정할 것.
"""
import io
import json
import re
import struct
import zipfile

from fetchutil import urlread

# 서버별 설정 배포 지점 (network_config)
CONF = {
    "kr": "https://ak-conf.arknights.kr/config/prod/official/network_config",
    "cn": "https://ak-conf.hypergryph.com/config/prod/official/network_config",
    "jp": "https://ak-conf.arknights.jp/config/prod/official/network_config",
    "en": "https://ak-conf.arknights.global/config/prod/official/network_config",
}
UA = "terra-archive-cdn/1.0"


def _get(url, binary=False):
    raw = urlread(url, timeout=180, ua=UA)
    return raw if binary else json.loads(raw.decode("utf-8"))


class Cdn:
    """한 서버의 현재 리소스 버전에 붙어 번들을 꺼내온다."""

    def __init__(self, server="kr", platform="Android", cache_dir=None):
        conf = _get(CONF[server])
        net = json.loads(conf["content"])
        self.urls = net["configs"][net["funcVer"]]["network"]
        ver = _get(self.urls["hv"].replace("{0}", platform))
        self.res_version = ver["resVersion"]
        self.client_version = ver["clientVersion"]
        self.assets = "%s/%s/assets/%s" % (self.urls["hu"], platform, self.res_version)
        self.hot_update = _get(self.assets + "/hot_update_list.json")
        self.cache_dir = cache_dir
        self._manifest = None

    # ── 번들 ────────────────────────────────────────────────────────
    def bundle(self, name):
        """번들 하나를 바이트로. 번들은 zip 한 겹에 싸인 .dat 이다."""
        dat = name.replace("/", "_").replace("#", "__").split(".")[0] + ".dat"
        path = None
        if self.cache_dir:
            import os
            os.makedirs(self.cache_dir, exist_ok=True)
            path = os.path.join(self.cache_dir, "%s_%s" % (self.res_version, dat))
            if os.path.exists(path):
                return open(path, "rb").read()
        with zipfile.ZipFile(io.BytesIO(_get("%s/%s" % (self.assets, dat), binary=True))) as z:
            data = z.read(z.filelist[0])
        if path:
            open(path, "wb").write(data)
        return data

    # ── .idx 매니페스트 (에셋 경로 → 번들) ──────────────────────────
    def manifest(self):
        """{에셋 경로: 번들 이름}. 30MB 안팎이라 한 번만 파싱하고 들고 있는다."""
        if self._manifest is not None:
            return self._manifest
        buf = self.bundle(self.hot_update["manifestName"])[128:]

        u32 = lambda o: struct.unpack_from("<I", buf, o)[0]
        i32 = lambda o: struct.unpack_from("<i", buf, o)[0]
        u16 = lambda o: struct.unpack_from("<H", buf, o)[0]

        def tbl(o):
            vt = o - i32(o)
            n = (u16(vt) - 4) // 2
            return lambda s: (o + u16(vt + 4 + s * 2)) if s < n and u16(vt + 4 + s * 2) else None

        def s_at(fo):
            so = fo + u32(fo)
            return buf[so + 4:so + 4 + u32(so)].decode("utf-8")

        def v_at(fo):
            vo = fo + u32(fo)
            return vo + 4, u32(vo)

        root = tbl(u32(0))
        base, n = v_at(root(1))
        bundles = []
        for i in range(n):
            t = tbl(base + i * 4 + u32(base + i * 4))
            f = t(0)
            bundles.append(s_at(f) if f else "")
        base, n = v_at(root(2))
        out = {}
        for i in range(n):
            t = tbl(base + i * 4 + u32(base + i * 4))
            fa, fb = t(0), t(1)
            if fa:
                out[s_at(fa)] = bundles[i32(fb)] if fb else ""
        self._manifest = out
        return out

    def find(self, prefix):
        """경로 접두사로 에셋을 찾는다 — 표 이름 뒤에 해시가 붙어 있어서 필요하다.
           예: 'gamedata/excel/activity_table' → 'gamedata/excel/activity_table556f56'"""
        hits = [(p, b) for p, b in self.manifest().items() if p.startswith(prefix)]
        if not hits:
            raise KeyError("매니페스트에 없음: " + prefix)
        return sorted(hits)[0]

    def text_asset(self, prefix):
        """gamedata 표 하나를 **RSA 서명을 뗀 FlatBuffer 바이트**로 돌려준다."""
        path, bundle = self.find(prefix)
        import UnityPy
        env = UnityPy.load(io.BytesIO(self.bundle(bundle)))
        for obj in env.objects:
            if obj.type.name != "TextAsset":
                continue
            d = obj.read()
            s = d.m_Script
            raw = s.encode("utf-8", "surrogateescape") if isinstance(s, str) else bytes(s)
            return raw[128:], path       # 앞 128바이트는 RSA 서명
        raise KeyError("TextAsset 없음: " + path)


def unity_lzham():
    """아크나이츠 번들은 Unity 표준이 아닌 LZHAM 압축을 쓴다 — UnityPy에 물려준다."""
    import lz4inv
    from UnityPy.enums.BundleFile import CompressionFlags
    from UnityPy.helpers.CompressionHelper import DECOMPRESSION_MAP
    DECOMPRESSION_MAP[CompressionFlags.LZHAM] = lz4inv.decompress_buffer


# ── FlatBuffer 스키마 ───────────────────────────────────────────────
def parse_fbs(text):
    """(테이블 이름 → {필드: 타입}, root_type). 선언 순서를 지킨다."""
    tables = {}
    for m in re.finditer(r"^(?:table|struct)\s+(\w+)\s*\{(.*?)^\}", text, re.S | re.M):
        fields = {}
        for fm in re.finditer(r"^\s*(\w+)\s*:\s*([^;=]+?)\s*(?:=\s*[^;]+?)?\s*;",
                              m.group(2), re.M):
            fields[fm.group(1)] = fm.group(2).strip()
        tables[m.group(1)] = fields
    root = re.search(r"root_type\s+(\w+)\s*;", text)
    return tables, (root.group(1) if root else None)


def root_slots(fb):
    """FlatBuffer 바이너리의 루트 vtable 슬롯 수. 스키마 필드 수와 맞아야 한다."""
    u32 = lambda o: struct.unpack_from("<I", fb, o)[0]
    i32 = lambda o: struct.unpack_from("<i", fb, o)[0]
    u16 = lambda o: struct.unpack_from("<H", fb, o)[0]
    root = u32(0)
    return (u16(root - i32(root)) - 4) // 2


class Normalizer:
    """flatc JSON → 공식 JSON. 판정은 전부 스키마 타입으로 한다 (모듈 docstring 참조)."""

    def __init__(self, fbs_text):
        self.tables, self.root = parse_fbs(fbs_text)

    def _conv(self, val, typ):
        if val is None:
            return None
        m = re.fullmatch(r"\[\s*(.+?)\s*\]", typ)
        if m:                                     # 벡터
            et = m.group(1)
            if not isinstance(val, list):
                return val
            if et.startswith("dict__"):           # 진짜 맵
                vt = self.tables.get(et, {}).get("value", "string")
                return {e.get("key"): self._conv(e.get("value"), vt)
                        for e in val if isinstance(e, dict)}
            if et.startswith("list_"):            # 중첩 배열 래퍼
                inner = self.tables.get(et, {}).get("values", "[string]")
                return [self._conv(e.get("values", []) if isinstance(e, dict) else e, inner)
                        for e in val]
            return [self._conv(e, et) for e in val]
        if typ in self.tables and isinstance(val, dict):
            out = {}
            for f, ft in self.tables[typ].items():   # 스키마 순서대로, 부재는 null
                out[f] = self._conv(val[f], ft) if f in val else None
            for k in val:                            # 스키마에 없는 건 살려 둔다
                out.setdefault(k, val[k])
            return out
        return val

    def run(self, data, unwrap=True):
        """unwrap: 루트 테이블의 필드가 **하나뿐이면 그 값을 그대로** 돌려준다.

        FlatBuffers는 최상위가 반드시 테이블이라, 원래 맵 하나인 표(character_table,
        skill_table, handbook_team_table…)에도 `characters` 같은 껍데기 필드가 하나 생긴다.
        공식 JSON은 그 껍데기가 없는 맨 맵이다 — 안 벗기면 파이프라인의 charId 조회가
        전부 None이 된다 (2026-09-02에 실제로 기물 121개의 이름·스킬이 통째로 날아갔다).
        activity_table(33필드)·item_table(여러 필드)처럼 필드가 둘 이상이면 그대로 둔다.
        """
        out = self._conv(data, self.root)
        spec = self.tables.get(self.root, {})
        if unwrap and len(spec) == 1 and isinstance(out, dict):
            only = next(iter(spec))
            if set(out) == {only}:
                return out[only]
        return out


def load_flatc_json(path, fbs_text):
    """flatc가 낸 JSON을 읽어 정규화한다.
       --allow-non-utf8 이 내는 \\xNN 은 JSON 문법이 아니라 \\u00NN 으로 바꿔 준다."""
    txt = open(path, encoding="utf-8", errors="replace").read()
    txt = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: "\\u00" + m.group(1), txt)
    return Normalizer(fbs_text).run(json.loads(txt))
