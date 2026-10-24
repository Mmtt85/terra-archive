// 훈수방 추천·비추천 아이콘 — 엄지 위/아래 (사용자 지시 2026-10-24 "따봉 아이콘, 따봉 반대 아이콘").
// 이모지는 기기마다 모양·색이 달라 선 아이콘으로 그린다(글자색을 따른다). 모양은 Lucide 'thumbs-up'(ISC), 아래는 같은 모양을 뒤집는다.

export function Thumb({ down, size = 14 }: { down?: boolean; size?: number }) {
  return (
    <svg className="thumb-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={down ? { transform: "rotate(180deg)" } : undefined}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}
