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
- 데이터는 `data/pm.db` (SQLite)에 저장됩니다.

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
