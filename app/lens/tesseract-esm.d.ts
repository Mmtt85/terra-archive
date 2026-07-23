// tesseract.js 브라우저 ESM 번들 서브패스 타입 선언 — ocr.ts가 명시적으로 이 경로를
// import한다 (패키지 루트를 쓰면 vinext가 Node용 어댑터를 번들하는 문제 회피).
// 번들은 CJS 래핑이라 default export 하나에 전체 네임스페이스가 담긴다.
declare module "tesseract.js/dist/tesseract.esm.min.js" {
  const Tesseract: typeof import("tesseract.js");
  export default Tesseract;
}
