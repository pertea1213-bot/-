# 컨설팅 프로젝트 PM 관리 툴

Node.js/Express + SQLite 기반의 컨설팅 프로젝트 관리(PM) 풀스택 애플리케이션입니다. 진행 중인 컨설팅 프로젝트, 작업(칸반 보드), 마일스톤을 관리합니다.

## 실행 방법

### 로컬

```bash
npm install
npm start        # http://localhost:5000
```

`server.js`가 정적 파일(HTML)과 `/api` REST API를 함께 서비스합니다.

### GitHub Codespaces

이 저장소에는 `.devcontainer/devcontainer.json`이 포함되어 있어, GitHub의 **Code → Codespaces → Create codespace**로 열면 `npm install`과 `npm start`가 자동으로 실행되고 5000번 포트가 자동으로 미리보기로 열립니다. 별도 설정 없이 바로 확인할 수 있습니다.

## 기능

- `pm.html`: 로그인 후 전체 프로젝트/진행중/작업/지연 통계, 새 프로젝트 생성, 프로젝트 목록(진행률 표시)
- `pm-project.html`: 프로젝트 정보 수정, 마일스톤 체크리스트, 칸반 보드(할 일/진행중/완료)로 작업 관리
- `companies.html`: 기업정보 등록/검색/수정/삭제 (기업명, 사업자등록번호, 대표자, 업종, 지역, 담당자 연락처 등)
- `survey.html`: **로그인 없이 공개**된 기업조사표 입력 폼. 기업 담당자가 직접 접속해 기업개요·경영진·기술개발·생산현황·기술경쟁력 등을 입력하고, 제품 이미지/R&D 실적 자료를 첨부한 뒤 저장하면 화면이 초기화되어 다음 기업을 이어서 입력할 수 있습니다.
- `dashboard.html`: 제출된 기업조사표를 조회/검색/삭제하고, 전체 목록을 엑셀로, 개별 기업을 PDF(기업조사표 서식)로 다운로드합니다.
- 데이터는 `data/pm.db` (SQLite)에, 업로드 파일은 `data/uploads/`에 저장됩니다.

### 기업조사표 입력 폼에 대한 보안 설계 메모

`survey.html` → `POST /api/surveys`는 로그인 없이 외부에서 접근 가능한 공개 제출 폼입니다(요청 시 "기업이 직접 입력"하는 구조로 결정). 이에 따라 다음 방어 장치를 적용했습니다.

- **허니팟 필드**: 화면에는 보이지 않는 `website` 필드가 채워져 있으면 봇으로 간주해 저장 없이 성공 응답만 반환합니다.
- **속도 제한**: IP당 시간당 10회로 제한합니다(서버 재시작 시 초기화되는 메모리 기반 제한이며, 다중 인스턴스 배포 시에는 별도 저장소로 교체가 필요합니다).
- **첨부파일 검증**: jpg/png/webp/pdf만 허용하며, 파일당 8MB·건당 최대 5개로 제한하고 저장 파일명은 서버에서 무작위로 생성합니다.
- **조회/다운로드/삭제는 관리자 인증 필수**: 제출(`POST`)만 공개이며, 목록·상세·첨부파일 다운로드·엑셀/PDF 내보내기·삭제는 모두 기존 관리자 비밀번호 기반 인증이 필요합니다.
- 같은 사업자등록번호로 여러 번 제출하는 것을 막지 않습니다(정기 재조사를 허용하기 위함). 중복 제출 관리가 필요하면 대시보드에서 수동으로 확인 후 삭제해야 합니다.

### 관리자 비밀번호

환경변수 `ADMIN_PASSWORD`로 설정합니다 (미설정 시 기본값 `admin1234`, 배포 시 반드시 변경하세요).

```bash
ADMIN_PASSWORD=원하는비밀번호 npm start
```

### API 개요

| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/api/admin/login` | 로그인 (토큰 발급) |
| GET/POST | `/api/pm/projects` | 프로젝트 목록 조회 / 생성 |
| GET/PATCH/DELETE | `/api/pm/projects/:id` | 프로젝트 상세 조회 / 수정 / 삭제 |
| POST | `/api/pm/projects/:id/tasks` | 작업 추가 |
| PATCH/DELETE | `/api/pm/tasks/:id` | 작업 수정(상태 이동 포함) / 삭제 |
| POST | `/api/pm/projects/:id/milestones` | 마일스톤 추가 |
| PATCH/DELETE | `/api/pm/milestones/:id` | 마일스톤 수정(완료 체크) / 삭제 |
| GET | `/api/companies?q=검색어` | 기업 목록 조회 (기업명/사업자등록번호/대표자/업종 검색) |
| POST | `/api/companies` | 기업정보 등록 |
| GET/PATCH/DELETE | `/api/companies/:id` | 기업정보 조회 / 수정 / 삭제 |
| POST | `/api/surveys` | 기업조사표 제출 (**공개, 인증 불필요**) — multipart/form-data, `productImages`/`rndFiles` 파일 포함 |
| GET | `/api/surveys?q=검색어` | 기업조사표 목록 조회 (admin) |
| GET | `/api/surveys/summary` | 대시보드 통계 (admin) |
| GET | `/api/surveys/:id` | 기업조사표 상세 조회 (admin) |
| DELETE | `/api/surveys/:id` | 기업조사표 삭제 (admin, 첨부파일 포함) |
| GET | `/api/surveys/attachments/:id/file` | 첨부파일(이미지/PDF) 스트리밍 (admin) |
| GET | `/api/surveys/export/excel` | 전체 기업조사표 엑셀 다운로드 (admin, 다중 시트) |
| GET | `/api/surveys/:id/export/pdf` | 개별 기업조사표 PDF 다운로드 (admin) |
