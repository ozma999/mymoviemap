# 취향 유전자 지도 — 영화판 (배포 테스트 뼈대)

이 폴더 안 파일 4개를 GitHub에 올리고 Vercel에 연결하면, mymangamap.vercel.app과 똑같은 방식으로
`내주소.vercel.app` 사이트가 생깁니다. 아직 지도·매칭 같은 진짜 기능은 없고,
**"검색 → 제출 → 저장 → 목록 보기"가 실제로 되는지**만 확인하는 최소 버전입니다.

## 파일이 하는 일

| 파일 | 하는 일 |
|---|---|
| `index.html` | 방문자가 보는 화면 전체. 영화 검색, 10편 고르기, 이름 적고 제출, 제출 목록 보기 |
| `api/club.js` | "서버" 역할. 이 파일 하나가 저장(POST)과 불러오기(GET)를 담당 |
| `movie_dict.json` | 사전 338편 데이터. `index.html`이 이 파일을 읽어서 검색창에 씁니다 |
| `package.json` | `api/club.js`가 Upstash(저장소)에 접속할 때 쓰는 라이브러리 목록 |

## 올리는 순서

1. **GitHub에서 새 저장소 만들기**
   - github.com 로그인 → 오른쪽 위 `+` → `New repository`
   - 이름 입력 (예: `mymoviemap`) → `Create repository`

2. **이 폴더 파일 그대로 업로드**
   - 방금 만든 저장소 페이지에서 `Add file` → `Upload files` 클릭
   - 이 폴더(`movie-map-starter`) 안의 파일/폴더를 **통째로** 끌어다 놓기
     (`index.html`, `movie_dict.json`, `package.json`, `api` 폴더 전부)
   - 아래 `Commit changes` 버튼 클릭

   ※ GitHub 웹 업로드는 폴더 구조를 그대로 유지합니다.
   `api/club.js`가 `api`라는 폴더 안에 들어있는 채로 올라가야 다음 단계에서 인식됩니다.

3. **Vercel에서 이 저장소 가져오기**
   - vercel.com → GitHub로 로그인 → `Add New` → `Project`
   - 방금 올린 저장소 선택 → `Deploy`
   - Framework Preset은 `Other`로 두면 됩니다 (Vercel이 `api/` 폴더를 자동으로 인식합니다)

4. **Storage 연결 (Upstash Redis)**
   - 배포된 프로젝트 페이지 → 상단 `Storage` 탭 → `Browse Marketplace`
   - `Upstash for Redis` 선택 → 이 프로젝트에 연결
   - 연결하면 비밀번호 같은 값이 자동으로 프로젝트에 들어갑니다 (직접 입력할 필요 없음)

5. **재배포**
   - Storage를 4번에서 새로 연결했다면, `Deployments` 탭에서 최신 배포 옆 `···` → `Redeploy` 한 번
   - 끝나면 `내주소.vercel.app` 접속 → 검색해서 영화 몇 편 고르고 제출 → 아래 목록에 뜨면 성공

## 안 될 때 — 먼저 진단 주소를 열어보세요

브라우저 주소창에 이렇게 입력하면 저장소 연결 상태를 알려줍니다.
(비밀키 **값**은 절대 표시되지 않고, 변수 **이름**만 보여줍니다.)

```
https://내주소.vercel.app/api/club?diag=1
```

- `"연결됨": true` → 정상. 그래도 제출이 안 되면 `Deployments` 탭에서 Redeploy 한 번.
- `"연결됨": false` 이고 `발견된_저장소_관련_변수이름`이 **빈 목록** → Storage 연결(4번)이 안 된 상태입니다.
- `"연결됨": false` 인데 변수 이름은 여러 개 보임 → 이름이 예상과 다른 경우입니다. 그 목록을 알려주시면 맞춰 드리겠습니다.

### 자주 나오는 증상

| 증상 | 원인 |
|---|---|
| `Failed to parse URL from /pipeline` | 저장소 접속 주소가 비어 있음 = Storage 미연결 또는 Redeploy 안 함 |
| 화면은 뜨는데 검색이 안 됨 | `movie_dict.json`이 `index.html`과 같은 위치(루트)에 없음 |
| 제출 버튼이 계속 회색 | 버튼 아래 "남은 것 —" 줄에 무엇이 부족한지 표시됩니다 |
