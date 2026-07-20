"""원격 fetch 공용 재시도 헬퍼 — 파이프라인 스크립트(fetch-gamedata / build-story / build-farm)용.

GitHub Actions 러너는 IP를 공유해 raw.githubusercontent.com 등에서 일시적 레이트리밋
(429)·5xx·타임아웃이 드물지 않게 난다 (첫 무인 실행 실패 원인 후보, 2026-07-21).
로컬에선 멀쩡한데 CI만 죽는 플레이크를 막기 위해 지수 백오프 재시도를 한 곳에 모은다.

- 재시도 대상: 429, 5xx, URLError(네트워크), 타임아웃
- 재시도 제외: 404 등 4xx — 진짜 없는 리소스(예: CN 썸네일 404 → 플레이스홀더 처리)는
  기존 호출부의 예외 처리로 즉시 전파해야 한다.
"""
import time
import urllib.error
import urllib.request


def urlread(url, timeout=60, tries=3, ua="terra-archive-fetch"):
    """URL 본문 bytes 반환. 일시 오류는 tries회까지 지수 백오프(2s, 4s) 재시도."""
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    for attempt in range(1, tries + 1):
        try:
            return urllib.request.urlopen(req, timeout=timeout).read()
        except urllib.error.HTTPError as err:
            # 4xx는 재시도해도 결과가 같다 — 단 429(레이트리밋)만 예외적으로 재시도
            if err.code != 429 and err.code < 500:
                raise
            last = err
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            last = err
        if attempt < tries:
            time.sleep(2 ** attempt)  # 2s, 4s
    raise last
