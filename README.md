# 진단 도구 모음 + 컨설팅 일정관리

정적 진단 도구 페이지와, Node.js/Express + SQLite 기반의 컨설팅 예약·일정관리 풀스택 기능을 함께 제공합니다.

## 실행 방법

```bash
npm install
npm start        # http://localhost:5000
```

`server.js`가 정적 파일(HTML)과 `/api` REST API를 함께 서비스합니다.

## 컨설팅 일정관리 기능

- `consulting-booking.html`: 방문자가 날짜/시간을 선택해 컨설팅을 예약하고, 연락처로 본인 예약을 조회·취소할 수 있는 페이지
- `consulting-admin.html`: 관리자가 로그인 후 예약 목록을 확인/확정/완료/취소/삭제하고, 운영시간·휴게시간·휴무 요일·상담 유형을 설정하는 페이지
- 데이터는 `data/schedule.db` (SQLite)에 저장됩니다.

### 관리자 비밀번호

환경변수 `ADMIN_PASSWORD`로 설정합니다 (미설정 시 기본값 `admin1234`, 배포 시 반드시 변경하세요).

```bash
ADMIN_PASSWORD=원하는비밀번호 npm start
```

### API 개요

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/availability?date=YYYY-MM-DD` | 해당 날짜의 예약 가능 시간 조회 |
| GET | `/api/consulting-types` | 상담 유형 목록 |
| POST | `/api/appointments` | 예약 생성 |
| GET | `/api/appointments/lookup?phone=` | 연락처로 본인 예약 조회 |
| POST | `/api/appointments/:id/cancel` | 본인 예약 취소 (연락처 확인) |
| POST | `/api/admin/login` | 관리자 로그인 (토큰 발급) |
| GET/PATCH/DELETE | `/api/admin/appointments[/:id]` | 관리자 예약 관리 |
| GET/PUT | `/api/admin/settings` | 운영 설정 조회/변경 |
