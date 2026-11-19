# LIVEBUS 메인 — 첫 화면 파티클

## 이전 첫 화면 구현 참고 (`src/hero/`)

이전 메인은 `src/hero/main.js` 를 사용했다. 현재 `index.html`은 `src/service-preview/main.js`를 불러온다. 외부 라이브러리 없이 WebGL 로 그리고, 점 위치·색은 매 프레임 CPU 에서 계산한다.

UI 바로가기 https://all4uiteam.github.io/26_AF_livebusHP/


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


## 현재 메인 (`/`, `index.html`)
- 첫 진입 흐름 (이 페이지만): 검정 → 로고 'AILIVEBUS' 한 글자씩(`src/service-preview/entry.js`) → 구(기존 메인의 `src/hero/sphere.js` 를 읽기 전용으로 재사용) → 스크롤 단계. 로고 인트로는 로드당 한 번.
- 스크롤 단계 (자동 전환 없음, 제스처 한 번 = 서비스 하나, 위로는 역순): 구 → LIVEBUS → BMS → BIT → BIS(마지막, 더 내려가지 않음). 서비스에 들어오면 설명이 한 글자씩 저절로 나타남(투명도만, 글자당 40ms·0.3초 페이드). 구를 떠날 때 티커가 '찌직' 하고 사라지고, 돌아오면 다시 등장. 이 페이지에서는 Core Technology(도로) 마무리 화면을 뺐다.
- 입자 표현: 점마다 깊이(0 먼 곳~1 가까운 곳, 위치로 추정)를 두어 크기·밝기·선명도·마우스 시차가 조금씩 다름. 중심은 작고 선명한 가우시안, 밝은 점만 옅은 빛 번짐. `?fx=old` 로 개선 전 표현과 비교. 모바일(폭 700px 이하)은 입자 72%만 계산·표시
- 장면 점 샘플링(tools/build_scenes.py): 무대 해상도에서 저불일치 디더링(한 px 최대 1점) → 윤곽선이 끊기지 않음. 지운 핀·지명 자리는 비우지 않고 주변 무늬로 메움(heal). 분리 버스 다각형은 5px 넓혀 경계가 잘리지 않게
- 커서: 청백색 점 + 지연 링(마우스에서만, `?nocursor` 로 끔). LIVEBUS 바퀴: 이동 거리에 비례해 휠 안쪽만 회전
- 서비스 설명(임시 문구): `src/service-preview/copy.js`. 설명 서체 Freesentation SemiBold(600)는 눈누 jsDelivr CDN(`https://cdn.jsdelivr.net/gh/projectnoonnu/2404@1.0/Freesentation-6SemiBold.woff2`, SIL OFL)으로 `src/service-preview/style.css` 의 @font-face 에서 불러오고, 로드된 뒤 글자 애니메이션 시작. 티커는 Adobe Fonts의 Termina Bold(700)를 공식 임베드 https://use.typekit.net/pjc5yrp.css 로 불러온다
  - 단계는 `html[data-stage]` = boot·logo·sphere·service. 첫 페인트 숨김은 `index.html` 인라인 CSS. 확인용: `?intro=skip`(구에서 시작), `?scene=0~3`(서비스 장면에서 시작)
- 진입: `index.html` → `src/service-preview/main.js`. 이전 미리보기를 메인으로 교체했다. 구체 구현 `src/hero/sphere.js`와 관련 에셋은 재사용한다.
- 장면 순서: LIVEBUS(`libus-1`) → BMS(`bms-2`) → BIT(`bit-3`) → BIS(`bis-4`) → 반복. 전환: 확산 0.4초 → 관성 0.3초 → 재결합 1.3초 (`CFG.burst`)
- 원본 이미지: `src/service-preview/assets/source/` (런타임에서는 쓰지 않음)
- 장면 데이터: `src/service-preview/data/` — `tools/build_scenes.py` 로 생성
  (웹 요소로 바꿀 영역 지우기 `CLEAN`, 피사체 기준 크기·중심 맞춤 `BOX`, 장면별 밝기 맞춤 `LEVEL`, 점 역할 태그 `TAGS`)
  이미지를 바꾸면 `cd src/service-preview && python3 tools/build_scenes.py` (numpy, Pillow, opencv-python, scipy 필요)
  - 장면별 설정(지울 영역·태그·분리할 버스 다각형·기준점): `src/service-preview/scenes.config.json`
  - 크기는 검은 여백이 아니라 피사체 면적 기준으로 맞추고, 점 밝기·밀도는 libus-1 기준으로 맞춘다
- 시연 데이터·시간표(모든 장면이 같은 값 사용): `src/service-preview/demo.js`
- 버스 자세(점과 웹 요소가 함께 따름): `src/service-preview/poses.js`
- 장면 안 정보(버스 번호·도착정보·핀·연결선·정보 카드): `src/service-preview/overlays.js` → `infoLayer.js` 가 글자·핀을 점으로 바꿔 장면과 같은 셰이더로 그림 (HTML 글자 아님). BMS 핀 선택은 `.sp-stage` 의 보이지 않는 단추(마우스·키보드·터치), 읽기 보조 문구는 `.sp-live`. 헤더·소개 글·시연 표기 영역에는 점을 찍지 않음
- 확인용: `/?scene=0~3` 시작 장면, `&manual` 자동 재생 없이 `window.__sp.step(dt)`
- `vite.config.js`는 `index.html` 한 페이지를 빌드한다. 별도 `service-preview.html`은 제거했다.
