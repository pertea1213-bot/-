# 사업공고 자동 알림

사업공고를 정기적으로 수집해서 조건에 맞는 신규 공고만 이메일로 보내주는 스크립트입니다.
GitHub Actions가 매일 정해진 시각에 이 스크립트를 실행합니다 (Claude 세션은 예약 실행을 할 수 없기 때문에, 실행은 반드시 GitHub Actions가 담당합니다).

카카오톡 발송은 포함되어 있지 않습니다. 개인 카카오 API로는 자동 발송이 되지 않고, 여러 사람에게 보내려면
카카오톡 채널 개설과 알림톡 템플릿 사전 심사가 필요하기 때문입니다. 채널 승인을 받으면 `src/notify.js`
옆에 `notifyKakao(items, config)` 같은 함수를 추가하고 `src/index.js`에서 호출하면 됩니다.

## 동작 방식

1. `config.json`에 등록된 소스(`bizinfo`, `kstartup`, `nosa-notice`, `sba`)에서 공고 목록을 가져옵니다.
2. `filters.keywords` / `excludeKeywords` / `maxDaysUntilDeadline` 조건으로 걸러냅니다.
3. `data/sent-ids.json`에 없는(=아직 보내지 않은) 공고만 골라냅니다.
4. 신규 공고가 있으면 이메일로 한 번에 보냅니다.
5. 보낸 공고 ID를 `data/sent-ids.json`에 기록합니다 (GitHub Actions가 이 파일을 커밋합니다).

## 1. 로컬에서 준비하기

```bash
cd announcement-alert
npm install
cp .env.example .env   # 값 채우기, 이 파일은 절대 커밋하지 마세요
```

`.env`는 로컬 테스트용입니다. 실제 실행에 쓰려면 아래처럼 환경 변수를 셸에 로드하고 실행하세요.

```bash
export $(grep -v '^#' .env | xargs)
node src/index.js
```

## 2. API 키 발급

| 소스 | 발급처 | 비고 |
| --- | --- | --- |
| 기업마당 | https://www.bizinfo.go.kr/web/lay1/program/S1T175C174/apiDetail.do?id=bizinfoApi | `crtfcKey` 발급. 발급 후 실제 응답을 한 번 확인해서 `config.json`의 `sources[0].fields`가 실제 필드명과 일치하는지 확인하세요. |
| K-Startup | https://www.data.go.kr/data/15125364/openapi.do | 이용 신청 후 승인까지 며칠 걸릴 수 있습니다. 승인되면 발급되는 요청 URL과 서비스키를 `config.json`의 `sources[1].url`, `.env`의 `KSTARTUP_API_KEY`에 넣고 `enabled: true`로 바꾸세요. |
| 노사발전재단 | 필요 없음 | 게시판 HTML을 바로 읽어옵니다. 아래 "노사발전재단" 섹션 참고. |
| SBA(서울경제진흥원) | 필요 없음 | 홈페이지가 쓰는 내부 API를 그대로 씁니다. 아래 "SBA" 섹션 참고. |

`config.json`의 `fields` 매핑은 실제 API 응답 필드명과 다를 수 있습니다. 스크립트를 한 번 실행해서
"응답에서 목록을 찾지 못했습니다" 같은 에러가 나오면, `itemsPath`/`fields`를 응답 구조에 맞게 수정하세요.

### 노사발전재단 (`nosa-notice`)

API/RSS가 따로 없어서 `https://www.nosa.or.kr/board/list.brd?boardId=nosa05` ("사업공고/모집" 게시판)의
HTML을 직접 파싱합니다(`src/fetchNosaBoard.js`, `node-html-parser` 사용). 키·발급 절차가 필요 없어
바로 동작합니다. 다만 두 가지 한계가 있습니다.

- 상세 페이지가 자바스크립트(`ebList.readBulletin(...)`)로만 열려서 실제 글 주소를 확인하지 못했습니다.
  이메일의 링크는 일단 목록 페이지로 연결됩니다.
- 목록에 있는 날짜는 마감일이 아니라 **게시일**입니다. 실제 마감일을 보려면 첨부파일을 열어야 합니다.

지역·주제와 무관하게 이 기관 공고는 전부 보내도록 `config.json`에서 `alwaysInclude: true`로
설정되어 있습니다 — `filters.keywords`/`regions` 조건을 적용하지 않습니다(`excludeKeywords`와
`maxDaysUntilDeadline`은 그대로 적용됩니다).

### SBA — 서울경제진흥원 (`sba`)

공개 API가 없어서, sba.seoul.kr 홈페이지 자체가 내부적으로 호출하는
`POST https://www.sba.seoul.kr/Pages/Main.aspx/GetData`를 그대로 사용합니다
(`src/fetchSbaApi.js`). 로그인이나 세션 없이도 응답합니다.

- `P_TYPE: "ALL"`로 요청하기 때문에 지원사업 공고뿐 아니라 주간 소식지·행사 안내 같은
  것도 섞여서 옵니다. 너무 잡다하면 알려주세요 — `P_TYPE` 값을 지원사업 전용으로
  좁힐 수 있는지 다시 확인해보겠습니다.
- 상세 페이지 URL이 응답에 없어서 이메일 링크는 일단 홈페이지(`sba.seoul.kr`)로 연결됩니다.
- `nosa-notice`와 마찬가지로 `alwaysInclude: true`라 지역/키워드 필터 없이 전부 옵니다
  (서울 소재 기관이라 어차피 지역 필터와 방향이 같습니다).

## 3. Gmail 발송 설정

1. Google 계정에서 [앱 비밀번호](https://myaccount.google.com/apppasswords)를 생성합니다 (2단계 인증 필요).
2. `.env`의 `GMAIL_USER`에 본인 Gmail 주소, `GMAIL_APP_PASSWORD`에 생성된 앱 비밀번호, `NOTIFY_TO`에 받을 주소를 넣습니다.
   여러 명에게 보내려면 쉼표로 이어서 씁니다: `NOTIFY_TO=a@example.com,b@example.com`

## 4. GitHub Actions 활성화

저장소 **Settings → Secrets and variables → Actions**에서 아래 값을 등록하세요.

- `BIZINFO_API_KEY`
- `KSTARTUP_API_KEY` (아직 없으면 비워둬도 됨 — `kstartup` 소스가 `enabled: false`인 동안은 사용되지 않습니다)
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `NOTIFY_TO`
- `ANTHROPIC_API_KEY` (선택 — "오늘의 논평" 자동 작성에 씁니다. 없으면 그 섹션만 생략되고 나머지는 정상 발송됩니다. 자세한 내용은 9번 항목 참고)

등록 후 **Actions** 탭에서 `사업공고 자동 알림` 워크플로를 열고 **Run workflow**로 한 번 수동 실행해서
정상 동작을 확인하세요. 이후에는 매일 KST 09:00에 자동 실행됩니다 (`.github/workflows/announcement-alert.yml`의
`cron` 값을 바꾸면 시각을 조정할 수 있습니다).

## 5. 조건 바꾸기

`config.json`의 `filters`만 수정하면 됩니다.

```json
{
  "filters": {
    "keywords": ["소상공인", "디지털전환"],
    "excludeKeywords": ["폐업"],
    "regions": ["서울", "경기"],
    "maxDaysUntilDeadline": 14
  }
}
```

- `keywords`를 비워두면(`[]`) 분야와 상관없이 다 봅니다.
- `regions`는 API 응답 전체(`raw`)를 문자열로 뒤져서 지역명이 포함되어 있는지 봅니다. bizinfo API의 정확한 지역 필드명이 확인되지 않아 택한 방식이라, 관할 기관 주소가 우연히 서울인 전국 단위 공고까지 걸릴 수 있습니다. 며칠 지켜보고 오탐이 많으면 알려주세요 — 필드명을 확인해서 더 정확하게 좁힐 수 있습니다.

## 6. 이메일 레이아웃 (뉴스레터 스타일)

`config.json`의 `notify`에서 설정합니다.

```json
{
  "notify": {
    "subjectPrefix": "코코그룹 정책뉴스 클리핑",
    "signatureImagePath": "assets/signature.png"
  }
}
```

- `subjectPrefix`: 메일 제목 및 본문 상단 타이틀로 쓰입니다.
- 상단 헤더: 오른쪽 정렬로 "{연}년 {월}월 {주차}주차 / VOL. {발행 회차}"가 표시됩니다. 발행 회차는 실제 발송(테스트 발송 제외)마다 1씩 자동으로 늘어나며 `data/issue-number.json`에 저장됩니다(GitHub Actions가 커밋).
- `signatureImagePath`: 이메일 맨 아래에 원본 비율 그대로 들어가는 서명/약력 이미지입니다(예: 프로필 카드 이미지). 비워두면(`""`) 표시되지 않습니다.
- `signatureImagePath`를 쓰려면 이미지 파일을 저장소의 `announcement-alert/` 아래(예: `announcement-alert/assets/`)에 커밋해두어야 합니다.
- 모든 값은 모든 발송(기업마당·노사발전재단·SBA)에 공통으로 적용됩니다. 소스별로 다른 이미지를 넣는 기능은 아직 없습니다.

## 7. 카테고리(영역)별로 묶어서 보내기

`config.json`의 `categories`에서 설정합니다. 공고 제목·기관명 등에 특정 키워드가 있으면 그 카테고리로 분류해서,
이메일에서 카테고리별 소제목 + 좌우 2열 카드 형태로 묶어 보여줍니다(한 카테고리에 공고가 홀수 개면 마지막 줄
오른쪽 칸은 비워둡니다).

```json
{
  "categories": [
    { "name": "R&D", "keywords": ["R&D", "연구개발", "기술개발"] },
    { "name": "자금", "keywords": ["자금", "금융", "대출", "보증"] }
  ],
  "notify": {
    "uncategorizedLabel": "기타"
  }
}
```

- 배열 순서가 그대로 이메일에 나오는 순서입니다. 위에서부터 먼저 검사해서 **처음 걸리는 카테고리 하나**로만 분류합니다(공고 하나가 여러 키워드에 걸려도 중복으로 안 들어갑니다).
- 어떤 키워드에도 안 걸리면 `notify.uncategorizedLabel`(기본값 "오늘의 정책사업")로 묶여서 맨 뒤에 나옵니다.
- 지금 기본 카테고리(자금・금융지원 → 인건비・고용지원 → 세금・세제혜택 → 판로・마케팅・수출 → R&D・기술개발 → 창업・재도전 → 소공인・제조 → ESG・인증)는 컨설턴트의 서비스 메뉴가 아니라, 중소기업・벤처기업・소상공인 대표들이 실제로 가장 관심 있어 하는 순서(자금 → 인건비/고용 → 세제 혜택 → 판로/마케팅 → R&D → 창업 → 제조 → ESG)로 잡아뒀습니다. 필요하면 카테고리를 추가/삭제하거나 순서·키워드를 조정하세요.

## 8. "오늘의 정책뉴스" — 주요 일간지 기사 넣기

`config.json`의 `news`에서 설정합니다. 사업공고 카드 아래에 별도 섹션으로 좌우 2열 카드 형태로 들어갑니다.

```json
{
  "news": {
    "keywords": ["ESG", "주식시장", "금리", "중소기업 지원", "소상공인 지원"],
    "outlets": ["중앙일보", "조선일보", "한겨레", "경향신문"],
    "count": 10
  }
}
```

- 동작 방식: 각 언론사(`outlets`) × 각 키워드(`keywords`) 조합으로 Google 뉴스 RSS(`news.google.com/rss/search?q=키워드+site:언론사도메인`)를 검색해서, 언론사·키워드별 상위 기사를 모읍니다(`src/fetchNews.js`). API 키가 필요 없습니다.
- 정렬 기준: 공개 RSS로는 댓글 수·조회수를 알 수 없습니다. 그래서 **여러 키워드에 동시에 걸리는 기사**(여러 주제를 아우르는, 비중이 큰 기사로 간주)를 먼저, 그다음 **최신순**으로 정렬해서 상위 `count`(기본 10)건만 뽑습니다. 실제 댓글 수 기반 정렬은 아닙니다 — 필요하면 언론사별 댓글 수 API를 알려주시면 반영해보겠습니다.
- 지원 언론사(도메인 매핑)는 현재 중앙일보・조선일보・한겨레・경향신문 4곳입니다. 다른 언론사를 추가하려면 `src/fetchNews.js`의 `OUTLET_DOMAINS`에 도메인을 추가하세요.
- 매 발송(테스트 포함)마다 새로 검색하며, 발송 이력(`sent-ids.json`)과 무관하게 그날의 상위 기사를 다시 뽑습니다.
- `news`를 비워두거나(`{}`) `keywords`/`outlets`를 빈 배열로 두면 뉴스 섹션 없이 기존처럼 사업공고만 발송됩니다.

## 9. "오늘의 논평" — AI가 쓰는 경제 논평

`config.json`의 `commentary`에서 설정합니다. "오늘의 정책뉴스"에서 모은 헤드라인을 근거로 AI가 짧은 논평을
작성해서, 제목 바로 아래에 별도 박스로 넣습니다.

```json
{
  "commentary": {
    "author": "이호정 경영지도사",
    "stance": "한국 중소기업과 소상공인에 대한 적극적인 지원이 필요하다",
    "model": "claude-haiku-4-5-20251001"
  }
}
```

- 동작 방식: `src/writeCommentary.js`가 그날의 "오늘의 정책뉴스" 헤드라인 목록을 Anthropic API(`api.anthropic.com/v1/messages`)에 보내서, `author` 명의로 `stance` 논조의 200~300자 논평을 받아옵니다. 별도로 기사를 더 수집하지 않고 이미 모은 뉴스 헤드라인을 그대로 재사용합니다.
- **`ANTHROPIC_API_KEY` 저장소 시크릿이 꼭 필요합니다.** [console.anthropic.com](https://console.anthropic.com/settings/keys)에서 API 키를 발급받아 저장소 **Settings → Secrets and variables → Actions**에 `ANTHROPIC_API_KEY`로 등록하세요. 등록하지 않으면 이 섹션은 에러 없이 조용히 생략되고 나머지(사업공고·정책뉴스)는 평소처럼 발송됩니다.
- `stance`를 바꾸면 논조를, `author`를 바꾸면 서명을 바꿀 수 있습니다.
- 그날 수집된 뉴스가 0건이면(예: `news` 설정을 비워둔 경우) 논평도 생략됩니다.
- API 사용량에 따라 Anthropic 요금이 발생합니다 — 하루 한 번(또는 테스트 발송 시마다) 짧은 논평 하나를 생성하는 정도라 비용은 크지 않습니다.
