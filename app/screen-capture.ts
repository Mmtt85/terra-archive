"use client";

// 화면 캡처(getDisplayMedia) 공용 헬퍼 — 에뮬레이터/게임 창을 브라우저에서 캡처한다.
// 100% 클라이언트: 캡처 스트림은 이 브라우저 안에서만 처리되고 어디에도 전송되지 않는다.
// 오퍼 인식 스캐너(다음 단계)와 인프라 플래너 '에뮬레이터 연동'이 공유한다.

// 반드시 사용자 제스처(버튼 클릭) 안에서 호출해야 브라우저가 화면 선택창을 띄운다.
// displaySurface:"window" 힌트로 '창' 탭을 우선 노출해 에뮬레이터 창을 고르기 쉽게 한다.
export async function startDisplayCapture(): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getDisplayMedia) throw new DOMNotSupported();
  return md.getDisplayMedia({
    video: {
      // @ts-expect-error displaySurface는 최신 스펙 (미지원 브라우저는 무시)
      displaySurface: "window",
      frameRate: { ideal: 10, max: 30 },
    },
    audio: false,
    // @ts-expect-error selfBrowserSurface: 자기 탭은 후보에서 제외
    selfBrowserSurface: "exclude",
    // @ts-expect-error surfaceSwitching: 공유 중 다른 창으로 전환 허용
    surfaceSwitching: "include",
  });
}

// getDisplayMedia 미지원 브라우저 신호 (호출부에서 name으로 분기)
export class DOMNotSupported extends Error {
  name = "NotSupportedError";
  constructor() { super("getDisplayMedia not supported"); }
}

// 현재 프레임의 평균 밝기(0=검정 ~ 1=흰색). DRM 캡처 차단(검은 화면) 감지용.
// 아직 프레임이 없으면 1(밝음)로 취급해 성급한 경고를 막는다.
export function sampleBrightness(video: HTMLVideoElement): number {
  if (!video.videoWidth) return 1;
  const w = 32, h = 18;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 1;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  return sum / (w * h) / 255;
}
