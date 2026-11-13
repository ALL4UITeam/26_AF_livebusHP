# LIVEBUS 메인 — 첫 화면 파티클

## 현재 첫 화면 (`src/hero/`)

`index.html` 은 `src/hero/main.js` 를 불러온다. 외부 라이브러리 없이 WebGL 로 그리고, 점 위치·색은 매 프레임 CPU 에서 계산한다.

### 흐름
- **첫 섹션 루프**: 스크롤하지 않으면 구체 → 버스 → 정류장 → 도로 → 구체 … 반복 (장면 완성 후 `CFG.auto` 6초 뒤 다음, 전환 `CFG.burst` 2.6초 "팡" 퍼졌다 모임)
- **Technology 진입**: 어느 장면에서든(전환 중이어도) 처음 아래로 스크롤하면 첫 문장 ① 이 나타나고, 입자는 터지지 않고 지금 위치에서
  도로 자리로 부드럽게 이어진다(`CFG.skip` 1.4초, 방향이 같은 자리끼리 짝지음). 도로가 배경으로 유지되고 루프는 멈춤
- **한 줄씩**: 아래로 ① → ② → ③ 추가 (새 줄만 제자리에서 0 → 100%, 이전 줄은 100% 유지). 위로 ③ → ② → ① 역순으로 하나씩 사라지고,
  ① 이 사라지는 입력에서 바로 헤더·티커·소개 문구·SCROLL 과 자동 루프가 돌아온다
- **제스처** (`CFG.gesture`): 휠 한 칸·짧은 스와이프 한 번 = 한 단계. 같은 방향으로 이어지는 관성은 무시,
  반대 방향 입력은 바로 받음(방향 전환 직후 0.3초간 이전 방향의 작은 관성 꼬리는 무시), 입력이 0.14초 끊기거나 관성 바닥에서 다시 크게 올라오면 새 제스처
- **로고**: 전환 중에도 바로 구체로, 문구 0 단계
- **첫 로드**: `index.html` 의 인라인 스크립트·CSS 가 첫 페인트부터 헤더·티커·소개 문구·SCROLL 을 숨긴다(intro-pending).
  구체 첫 프레임이 그려진 뒤 헤더(0.1s) → 티커 글리치(0.4s) → 소개 제목(1.05s)·본문(1.6s) → SCROLL(2.15s). 고정 타이머로 먼저 드러내지 않음.
  스크립트·스타일 로드 실패, 이미지·WebGL 실패 시에는 바로 보이게 함

### 파일
- `src/hero/sphere.js` — Figma 원화 `src/assets/scenes/sphere-figma.png` 의 점을 그대로 쓰되 구 표면 좌표(경도·위도)로 바꿔 움직인다
  - 표면: 무늬가 곡면을 타고 좌우로 천천히 흐르고 커서 쪽으로 살짝 돌아봄. 위도마다 테두리 안쪽 폭 안에서 돌고, 한쪽 끝으로 나간 점은 반대쪽에서 다시 들어옴(끝은 흐림 → 틈 없음)
  - 테두리(`RIM` 바깥): 제자리라 둥근 윤곽이 항상 또렷
  - 바깥 잔점(`HALO`): 멀수록 어둡게(최대 88% 감소), 아주 먼 점은 절반 이하만, 흔들림은 거의 없음
  - 크기 `CFG.sphereSize` (1440×900 에서 테두리 지름 약 33%)
- `src/hero/sampleDots.js` — 버스·정류장·도로 PNG 의 빛 점 중심을 파티클 자리로, `featherScene` 으로 네모난 경계를 녹임
- `src/hero/main.js` — 장면·전환·입력·도로 위를 흐르는 입자(`CFG.road`, `ROAD_PATH`, `LANES`). 조정값은 맨 위 `CFG`
- 티커 글리치: main.js 가 티커를 두 장 복제해 얇은 가로 조각만 한두 번 어긋냈다 맞추고 지움 (흐름 위치를 맞춰서 이어짐)
- 확인용: `?scene=sphere|bus|bus-stop|road` (또는 0~3) 시작 장면, `&capture` 인트로·자동 전환 없음,
  `&manual` 자동 재생 없이 `window.__livebusHero.step(dt)` / `advance(±1)` 로 한 프레임·한 단계씩(영상 캡처용)

### 실행
```bash
npm install
npm run dev      # 개발 서버 (index.html 을 파일로 직접 열면 동작하지 않음)
npm run build    # 프로덕션 빌드 → dist/ (master 에 push 하면 GitHub Pages 로 배포)
```

### 소스 구성 (1차 완료 시점 정리)
```
index.html                     첫 로드 숨김 CSS·실패 대비 스크립트(인라인) + 화면 마크업
src/style.css                  UI·Technology 문구·첫 로드 애니메이션
src/hero/main.js               장면 루프·전환·스크롤·도로 입자·렌더링 (조정값 CFG)
src/hero/sphere.js             첫 장면 구체
src/hero/sampleDots.js         장면 PNG → 점, 네모난 경계 녹이기
src/assets/scenes/*.png        sphere-figma(구체), bus, bus-stop, road
src/assets/*.svg               로고(H1), 티커 아이콘(Icon), SCROLL 화살표(ChevronDown)
```
외부 런타임 라이브러리 없음 (개발 의존성은 vite 하나). 이전 3D 모델 방식(three.js, `src/main.js`·`src/models/` 등)은 정리했고 git 기록에 남아 있다.

