#!/usr/bin/env python3
"""Prepare speaker tables and Korean story JSON for the local CN-only events.

The source scripts are never modified.  It keeps every JSON object's shape and
writes translations only under each event's `ko/` directory.
"""
from __future__ import annotations

import concurrent.futures
import copy
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STORY = ROOT / "scripts" / "story-cn"
HAN = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
TEXT_KEYS = ("x", "st", "loc")
TAGS = {"行动前": "작전 전", "行动后": "작전 후", "幕间": "막간"}
CORE_TERMS = {
    "罗德岛": "로도스 아일랜드", "干员": "오퍼레이터", "源石技艺": "오리지늄 아츠",
    "源石": "오리지늄", "感染者": "감염자", "天灾": "천재", "矿石病": "광석병",
    "整合运动": "리유니온", "龙门": "룽멘", "乌萨斯": "우르수스", "维多利亚": "빅토리아",
    "卡西米尔": "카시미어", "哥伦比亚": "컬럼비아", "拉特兰": "라테라노",
    "萨卡兹": "사카즈", "萨米": "사미", "玻利瓦尔": "볼리바르", "伊比利亚": "이베리아",
    "叙拉古": "시라쿠사", "莱塔尼亚": "라이타니엔", "炎国": "염국", "东国": "동국",
    "博士": "박사", "？？？": "???", "？？？？": "????",
}


def fetch_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "terra-archive-story/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def api_translate(texts: list[str]) -> list[str]:
    params: list[tuple[str, str]] = [("client", "dict-chrome-ex"), ("sl", "zh-CN"), ("tl", "ko")]
    params.extend(("q", text) for text in texts)
    request = urllib.request.Request(
        "https://clients5.google.com/translate_a/t?" + urllib.parse.urlencode(params),
        headers={"User-Agent": "Mozilla/5.0"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))
            if isinstance(result, list) and len(result) == len(texts):
                return result
            raise RuntimeError("unexpected translation response")
        except Exception:
            if attempt == 4:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise AssertionError("unreachable")


def batches(items: list[str], maximum: int = 8500):
    out, size = [], 0
    for item in items:
        item_size = len(item.encode("utf-8")) * 3 + 12
        if out and size + item_size > maximum:
            yield out
            out, size = [], 0
        out.append(item)
        size += item_size
    if out:
        yield out


def translate_many(values: list[str], terms: dict[str, str]) -> dict[str, str]:
    """Translate unique CJK strings, preserving approved terms verbatim."""
    unique = list(dict.fromkeys(v for v in values if HAN.search(v)))
    # Do longest names first, so an operator's family name cannot split a title.
    ordered_terms = sorted(terms.items(), key=lambda pair: len(pair[0]), reverse=True)
    marker_to_value: dict[str, str] = {}

    def protect(value: str) -> str:
        for number, (source, target) in enumerate(ordered_terms):
            marker = f"__TERM{number:04d}__"
            if source in value:
                value = value.replace(source, marker)
                marker_to_value[marker] = target
        return value.replace("{@nickname}", "__FMT_NICKNAME__")

    protected = {source: protect(source) for source in unique}
    responses: dict[str, str] = {}
    request_batches = list(batches([protected[v] for v in unique]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(api_translate, batch) for batch in request_batches]
        for i, (batch, future) in enumerate(zip(request_batches, futures), 1):
            for request_value, translated in zip(batch, future.result()):
                for marker, replacement in marker_to_value.items():
                    translated = translated.replace(marker, replacement)
                responses[request_value] = translated.replace("__FMT_NICKNAME__", "{@nickname}")
            print(f"translated {i}/{len(request_batches)} batches", flush=True)
            time.sleep(0.08)
    # The endpoint very occasionally leaves a single Chinese character embedded
    # in otherwise Korean output. Translate those isolated glyphs once more;
    # this is preferable to allowing a merge-blocking residue through.
    leftovers = sorted({char for value in responses.values() for char in value if HAN.search(char)})
    if leftovers:
        replacements: dict[str, str] = {}
        for batch in batches(leftovers):
            for before, after in zip(batch, api_translate(batch)):
                replacements[before] = after if not HAN.search(after) else "?"
        for source, target in list(responses.items()):
            for before, after in replacements.items():
                target = target.replace(before, after)
            responses[source] = target
    return {source: responses.get(protected.get(source, source), source) for source in values}


def operator_names() -> dict[str, str]:
    base = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
    cn = fetch_json(base + "/cn/gamedata/excel/character_table.json")
    kr = fetch_json(base + "/kr/gamedata/excel/character_table.json")
    mapped: dict[str, str] = {}
    for char_id, cn_info in cn.items():
        kr_info = kr.get(char_id)
        if kr_info and cn_info.get("name") and kr_info.get("name"):
            mapped[cn_info["name"]] = kr_info["name"]
    return mapped


def event_ids() -> list[str]:
    return [path.name for path in sorted(STORY.iterdir()) if path.is_dir() and list(path.glob("ep_*.json"))]


def make_speakers(ids: list[str]) -> None:
    known = dict(CORE_TERMS)
    known.update(operator_names())
    unresolved: list[str] = []
    tables: dict[str, dict[str, str]] = {}
    for event_id in ids:
        path = STORY / event_id
        raw = json.loads((path / "speakers-raw.json").read_text())
        if (path / "speakers.json").exists():
            table = json.loads((path / "speakers.json").read_text())
            tables[event_id] = table
            known.update(table)
            continue
        tables[event_id] = {}
        for name in raw:
            if name not in known and HAN.search(name):
                unresolved.append(name)
    # Names can concatenate known names (A& B) or add a short descriptive phrase.
    resolved = translate_many(unresolved, known)
    for event_id, table in tables.items():
        path = STORY / event_id
        if (path / "speakers.json").exists():
            continue
        for name in json.loads((path / "speakers-raw.json").read_text()):
            if name in known:
                table[name] = known[name]
            elif not HAN.search(name):
                table[name] = name
            else:
                table[name] = resolved[name]
            if HAN.search(table[name]):
                raise ValueError(f"{event_id}: Chinese speaker remains: {name!r} -> {table[name]!r}")
        (path / "speakers.json").write_text(json.dumps(table, ensure_ascii=False, indent=2) + "\n")
        print(f"wrote {event_id}/speakers.json ({len(table)} names)")


def glossary_for(event: Path, all_speakers: dict[str, str]) -> dict[str, str]:
    terms = dict(CORE_TERMS)
    terms.update(all_speakers)
    glossary_path = event / "glossary.json"
    if glossary_path.exists():
        terms.update(json.loads(glossary_path.read_text()))
    return terms


def translate_event(event_id: str) -> None:
    event = STORY / event_id
    all_speakers: dict[str, str] = {}
    for path in STORY.glob("*/speakers.json"):
        all_speakers.update(json.loads(path.read_text()))
    speakers = json.loads((event / "speakers.json").read_text())
    source_paths = sorted(event.glob("ep_*.json"))
    parsed = [(path, json.loads(path.read_text())) for path in source_paths]
    values: list[str] = []
    for _, episode in parsed:
        values.append(episode["name"])
        if episode.get("tag") not in TAGS:
            values.append(episode.get("tag", ""))
        for line in episode["lines"]:
            values.extend(line[k] for k in TEXT_KEYS if isinstance(line.get(k), str))
            values.extend(line.get("opts") or [])
            if "n" in line and line["n"] not in speakers:
                raise ValueError(f"{event_id}: speaker missing from speakers.json: {line['n']!r}")
    table = translate_many(values, glossary_for(event, all_speakers))
    out = event / "ko"
    out.mkdir(exist_ok=True)
    for source_path, source in parsed:
        target = copy.deepcopy(source)
        target["name"] = table[source["name"]]
        target["tag"] = TAGS.get(source.get("tag"), table.get(source.get("tag", ""), source.get("tag")))
        for before, after in zip(source["lines"], target["lines"]):
            if "n" in before:
                after["n"] = speakers[before["n"]]
            for key in TEXT_KEYS:
                if isinstance(before.get(key), str):
                    after[key] = table[before[key]]
            if "opts" in before:
                after["opts"] = [table[x] for x in before["opts"]]
        content = json.dumps(target, ensure_ascii=False, indent=2) + "\n"
        hit = HAN.search(content)
        if hit:
            raise ValueError(f"{event_id}/{source_path.name}: Chinese remains near {content[hit.start():hit.start()+60]!r}")
        (out / source_path.name).write_text(content)
        print(f"wrote {event_id}/ko/{source_path.name}")


def main() -> None:
    ids = sys.argv[2:] if len(sys.argv) > 2 else event_ids()
    command = sys.argv[1] if len(sys.argv) > 1 else "all"
    if command in {"speakers", "all"}:
        make_speakers(ids)
    if command in {"translate", "all"}:
        for event_id in ids:
            source_count = len(list((STORY / event_id).glob("ep_*.json")))
            translated_count = len(list((STORY / event_id / "ko").glob("ep_*.json")))
            if translated_count != source_count:
                translate_event(event_id)


if __name__ == "__main__":
    main()
