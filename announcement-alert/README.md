# 사업공고 자동 알림

사업공고를 정기적으로 수집해서 조건에 맞는 신규 공고만 이메일로 보내주는 스크립트입니다.
GitHub Actions가 매일 정해진 시각에 이 스크립트를 실행합니다 (Claude 세션은 예약 실행을 할 수 없기 때문에, 실행은 반드시 GitHub Actions가 담당합니다).

카카오톡 발송은 포함되어 있지 않습니다. 개인 카카오 API로는 자동 발송이 되지 않고, 여러 사람에게 보내려면
카카오톡 채널 개설과 알림톡 템플릿 사전 심사가 필요하기 때문입니다. 채널 승인을 받으면 `src/notify.js`
옆에 `notifyKakao(items, config)` 같은 함수를 추가하고 `src/index.js`에서 호출하면 됩니다.

## 동작 방식

1. `config.json`에 등록된 소스(`bizinfo`, `kstartup`)에서 공고 목록을 가져옵니다.
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

`config.json`의 `fields` 매핑은 실제 API 응답 필드명과 다를 수 있습니다. 스크립트를 한 번 실행해서
"응답에서 목록을 찾지 못했습니다" 같은 에러가 나오면, `itemsPath`/`fields`를 응답 구조에 맞게 수정하세요.

## 3. Gmail 발송 설정

1. Google 계정에서 [앱 비밀번호](https://myaccount.google.com/apppasswords)를 생성합니다 (2단계 인증 필요).
2. `.env`의 `GMAIL_USER`에 본인 Gmail 주소, `GMAIL_APP_PASSWORD`에 생성된 앱 비밀번호, `NOTIFY_TO`에 받을 주소를 넣습니다.

## 4. GitHub Actions 활성화

저장소 **Settings → Secrets and variables → Actions**에서 아래 값을 등록하세요.

- `BIZINFO_API_KEY`
- `KSTARTUP_API_KEY` (아직 없으면 비워둬도 됨 — `kstartup` 소스가 `enabled: false`인 동안은 사용되지 않습니다)
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `NOTIFY_TO`

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
    "maxDaysUntilDeadline": 14
  }
}
```
