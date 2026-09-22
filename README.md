# budget-backend

개인용 가계부 웹앱 백엔드 (NestJS + Prisma + PostgreSQL)

## 로컬 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env`에서 `DATABASE_URL`을 로컬 PostgreSQL 접속 정보에 맞게 수정하고,
`JWT_SECRET`은 충분히 긴 임의 문자열로 바꾼다.

### 3. PostgreSQL 준비

로컬에 PostgreSQL이 떠 있어야 한다 (Docker 예시):

```bash
docker run --name budget-db -e POSTGRES_USER=user -e POSTGRES_PASSWORD=password -e POSTGRES_DB=budget_db -p 5432:5432 -d postgres:16
```

### 4. 마이그레이션 적용

```bash
npm run prisma:migrate
```

### 5. 서버 실행

```bash
npm run dev
```

기본적으로 `http://localhost:3000`에서 뜬다.

## API 개요

- **인증**: `/auth/*`를 제외한 모든 엔드포인트는 `Authorization: Bearer <accessToken>` 헤더가 필요하다.
  토큰은 `POST /auth/login` 또는 `POST /auth/signup` 응답의 `accessToken`.
- **응답 형식**: 성공 시 항상 `{ "success": true, "data": <실제 응답> }`로 감싸서 내려간다
  ([ResponseInterceptor](src/common/interceptors/response.interceptor.ts)). 아래 표의 "응답"은 이 `data` 안에 들어가는
  내용만 적었다. 예외는 `/metrics` (Prometheus가 읽는 순수 텍스트라 감싸지 않음).
- **에러 형식**: `{ "success": false, "statusCode", "path", "timestamp", "message" }`
  ([AllExceptionsFilter](src/common/filters/all-exceptions.filter.ts)).
- **금액 필드**: `amount`/`balance`/`spent`/`remaining` 등은 전부 `BigInt`(원 단위 정수)로 저장되고,
  응답 직렬화 시 문자열로 변환된다 (JS의 `Number`가 안전하게 다룰 수 없는 큰 값이라도 정밀도 손실이 없게 하기 위함,
  [main.ts](src/main.ts) 참고). 요청 바디에 보낼 때는 숫자(`number`)로 보내면 된다.
- **소유권 검사**: 모든 리소스(계좌/카테고리/거래/예산/업로드)는 `userId`로 스코프되어 있어서,
  다른 사용자의 리소스 id를 넣으면 `403 Forbidden` 또는 `404 Not Found`가 난다.

### 인증

| Method | Path | Body | 응답 |
|---|---|---|---|
| POST | `/auth/signup` | `{ email, password }` | `{ accessToken, user }` |
| POST | `/auth/login` | `{ email, password }` | `{ accessToken, user }` |
| GET | `/users/me` | – | 로그인한 사용자 정보 |

### accounts (계좌)

| Method | Path | Body | 비고 |
|---|---|---|---|
| POST | `/accounts` | `{ name, type, balance?, currency? }` | `type`: `CASH`\|`BANK`\|`CARD` |
| GET | `/accounts` | – | 사용자의 전체 계좌 목록 |
| GET | `/accounts/:id` | – | |
| PATCH | `/accounts/:id` | `{ name?, type?, currency? }` | `balance`는 여기서 못 바꾼다 — 거래를 통해서만 변경됨 |
| DELETE | `/accounts/:id` | – | |

### categories (카테고리)

| Method | Path | Body | 비고 |
|---|---|---|---|
| POST | `/categories` | `{ name, type, parentId?, icon?, color? }` | `type`: `INCOME`\|`EXPENSE` |
| GET | `/categories` | – | `parentId` 기준 트리 형태로 반환 |
| GET | `/categories/:id` | – | |
| PATCH | `/categories/:id` | `{ name?, type?, parentId?, icon?, color? }` | |
| DELETE | `/categories/:id` | – | |

### transactions (거래)

| Method | Path | Body / Query | 비고 |
|---|---|---|---|
| POST | `/transactions` | `{ accountId, categoryId?, title, amount, type, transferAccountId?, date, memo?, isAuto?, source? }` | `type`(`INCOME`\|`EXPENSE`\|`TRANSFER`)에 따라 계좌 잔액이 자동 갱신됨 |
| GET | `/transactions` | 쿼리: `accountId?, categoryId?, type?, from?, to?, skip?, take?` | |
| GET | `/transactions/:id` | – | |
| PATCH | `/transactions/:id` | 위 생성 필드 중 일부 | 계좌/금액/타입 변경 시 기존 잔액 반영분을 되돌리고 새로 반영 |
| DELETE | `/transactions/:id` | – | 삭제 시 해당 거래의 잔액 반영분을 되돌림 |

### budgets (예산)

| Method | Path | Body | 비고 |
|---|---|---|---|
| POST | `/budgets` | `{ categoryId, amount, period, startDate }` | `categoryId`는 EXPENSE 카테고리만 허용, `period`: `MONTHLY`\|`WEEKLY` |
| GET | `/budgets` | – | 각 항목에 `periodStart`, `periodEnd`, `spent`, `remaining`, `usageRate` 포함 |
| GET | `/budgets/:id` | – | 위와 동일 |
| PATCH | `/budgets/:id` | `{ categoryId?, amount?, period?, startDate? }` | |
| DELETE | `/budgets/:id` | – | |

### uploads (명세서 업로드)

거래내역을 일괄 등록하는 플로우: 업로드 → (필요 시 행별 보정) → 확정. 이 API 자체는 CSV만 받는다 —
프론트엔드가 엑셀(XLSX/XLS) 파일도 지원하지만, 클라이언트에서 CSV로 변환한 뒤 보낸다.

| Method | Path | Body | 비고 |
|---|---|---|---|
| POST | `/uploads` | `multipart/form-data`, 필드명 `file` (CSV, 최대 5MB) | 헤더: `date,type,amount,memo,category` (`memo`,`category` 선택). `type`은 `INCOME`\|`EXPENSE`만. `category`는 이름이 같은(대소문자 무시) 기존 카테고리와 자동 매칭. `UploadBatch`(status=PENDING) + 파싱된 `UploadRow`들만 생성되고, 아직 거래는 안 만들어짐 |
| GET | `/uploads` | – | 사용자의 업로드 배치 목록 |
| GET | `/uploads/:id` | – | 파싱된 행(`rows`) 포함 |
| PATCH | `/uploads/:id/rows/:rowId` | `{ categoryId }` | 확정 전 미리보기 단계에서 자동 분류가 틀린 행의 카테고리를 고칠 때. `PENDING` 배치만 가능 |
| DELETE | `/uploads/:id/rows/:rowId` | – | 확정 전 특정 행을 배치에서 제외(중복이거나 원치 않는 행). `PENDING` 배치만 가능, `rowCount`도 같이 감소 |
| POST | `/uploads/:id/confirm` | `{ accountId }` | 남은 행들을 실제 `transactions`로 일괄 생성하고 계좌 잔액 반영, batch를 `CONFIRMED`로 변경 |
| POST | `/uploads/:id/cancel` | – | batch를 `CANCELLED`로 변경 (거래 생성 안 함) |

## Docker Compose 배포 (온프레미스 서버, 단일 노드)

`docker-compose.yml` 하나로 앱 + PostgreSQL + 모니터링(Prometheus/Grafana)까지 전부 뜬다.

### 1. 서버 준비물

- Docker Engine + Docker Compose plugin (`docker compose version`으로 확인)

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env`에서 최소한 아래 값들을 실제 운영용으로 바꿔야 한다:

- `JWT_SECRET` — 충분히 긴 임의 문자열
- `POSTGRES_PASSWORD`, `GRAFANA_ADMIN_PASSWORD` — 각각 별도의 강한 비밀번호
- `CORS_ORIGIN` — 실제 프론트엔드 도메인(들), 콤마로 여러 개 지정 가능

`DATABASE_URL`은 compose가 `POSTGRES_*` 값으로 자동 조립하므로 `.env`에 있는
`DATABASE_URL` 자체는 (로컬 `npm run dev`용이라) 무시된다.

### 3. 빌드 & 실행

```bash
docker compose up -d --build
```

- `app` 컨테이너는 시작 시 `prisma migrate deploy`를 자동으로 실행한 뒤 서버를 띄운다
  ([docker/entrypoint.sh](docker/entrypoint.sh)).
- `postgres`는 헬스체크를 통과해야 `app`이 뜨기 시작한다.

상태 확인:

```bash
docker compose ps
docker compose logs -f app
```

### 4. 접속 지점

| 서비스 | 주소 | 비고 |
|---|---|---|
| API | `http://<서버>:3000` | 프론트엔드가 호출하는 엔드포인트 |
| Grafana | `http://<서버>:3001` | 최초 로그인은 `.env`의 `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD` |
| Prometheus | `http://127.0.0.1:9090` (서버 로컬에서만) | 자체 인증이 없어 localhost에만 바인딩해뒀다. 외부에서 보려면 SSH 터널(`ssh -L 9090:localhost:9090 <서버>`) 사용 |

Grafana에는 Prometheus 데이터소스와 "Budget Backend Overview" 대시보드가 자동으로 프로비저닝되어 있다
(HTTP 요청량/에러율/p95 레이턴시, 앱 메모리, 호스트 CPU, Postgres up/down).

### 5. 모니터링 구성 요소

- `budget-backend` 앱이 직접 `/metrics`에 요청 수/지연시간/Node.js 기본 메트릭을 노출한다
  ([src/metrics](src/metrics)).
- `postgres-exporter`가 DB 메트릭을, `node-exporter`가 서버(호스트) 메트릭을,
  `cadvisor`가 컨테이너별 리소스 사용량을 Prometheus에 공급한다.

### 6. 운영 시 고려할 점 (다음 단계)

- **리버스 프록시 + TLS**: 지금은 `app`/`grafana`가 평문 HTTP로 포트 그대로 열려 있다. 실제 도메인을
  붙인다면 nginx/Caddy + Let's Encrypt로 앞단을 감싸는 걸 권장한다.
- **방화벽**: `3000`/`3001` 포트도 필요한 곳(사무실 IP, VPN 등)으로 제한하는 걸 권장한다.
  `postgres`/`postgres-exporter`/`node-exporter`/`cadvisor`는 호스트 포트를 열지 않았으니 외부에서
  접근 불가능하다.
- **백업**: `postgres_data` 볼륨을 주기적으로 덤프/백업하는 크론잡이 필요하다.
- **알림**: 지금은 대시보드만 있고 알림(Alertmanager, Grafana Alerting)은 설정하지 않았다. 에러율/CPU
  임계치 알림이 필요하면 추가로 붙일 수 있다.

## 참고

- `UploadRow`는 최초 스펙에는 없었지만, 업로드 확정 전까지 파싱된 행을 보관할 곳이 필요해서
  추가한 보조 테이블이다 ([schema.prisma](prisma/schema.prisma) 참고).
- `Transaction.title`도 최초 스펙엔 없었다 — 프론트엔드에서 거래처/제목을 `memo`와 별도로 보여줘야 해서
  나중에 추가했다. 로컬 DB가 이 마이그레이션 이전 상태라면 `npm run prisma:migrate`를 다시 실행해야 한다.
