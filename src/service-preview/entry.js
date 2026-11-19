/**
 * 첫 진입: 검정 화면 → 로고 'AILIVEBUS' 가 왼쪽부터 한 글자씩 (이 페이지 전용)
 *
 * - 로고는 index.html 에 글자 단위 <g class="sp-glyph"> 로 인라인되어 있고, 첫 페인트부터 글자는 투명.
 *   SVG 크기가 처음부터 고정이라 글자가 더해져도 로고 위치가 움직이지 않는다.
 * - 글자마다 .is-on → CSS 로 짧은 페이드(0.42초). 커서·바운스 없음.
 * - 페이지 로드당 한 번만 실행. 구 화면으로 돌아와도 다시 재생하지 않는다 (main.js 가 stage 로 관리).
 */
export const LOGO = {
  blank: 0.08, // 순수 검정 유지 (초)
  step: 0.055, // 글자 간격 (초) — 9글자, 앞 글자가 나타나는 동안 다음 글자가 이어서
  fade: 0.16, // 글자 하나가 나타나는 시간 (초) — index.html 인라인 CSS .sp-glyph 와 같음 → 로고 전체 등장 약 0.6초
  hold: 0.12, // 완성된 로고를 잠깐 보여 줌 (초). 그 뒤 0.74초 동안 축소하며 헤더로 (style.css .brand)
};

/** 로고 재생. 끝나면(마지막 글자 + 유지) resolve */
export function playLogo({ reduce }) {
  const root = document.documentElement;
  const glyphs = [...document.querySelectorAll('.sp-glyph')];
  root.dataset.stage = 'logo';
  if (reduce) { // 동작 줄이기: 한 번에 짧게
    glyphs.forEach((g) => g.classList.add('is-on'));
    return wait(250 + 150);
  }
  glyphs.forEach((g, i) => setTimeout(() => g.classList.add('is-on'), (LOGO.blank + i * LOGO.step) * 1000));
  return wait((LOGO.blank + (glyphs.length - 1) * LOGO.step + LOGO.fade + LOGO.hold) * 1000);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
