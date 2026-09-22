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

모든 API(회원가입/로그인 제외)는 `Authorization: Bearer <accessToken>` 헤더가 필요하다.

## 인증 API

- `POST /auth/signup` — `{ email, password }`
- `POST /auth/login` — `{ email, password }` → `{ accessToken, user }`
- `GET /users/me`

## accounts

- `POST /accounts` — `{ name, type, balance?, currency? }`
- `GET /accounts`, `GET /accounts/:id`
- `PATCH /accounts/:id` — `{ name?, type?, currency? }` (balance는 거래를 통해서만 변경)
- `DELETE /accounts/:id`

## categories

- `POST /categories` — `{ name, type, parentId?, icon?, color? }`
- `GET /categories` — `parentId` 기준 트리 형태로 반환
- `GET /categories/:id`, `PATCH /categories/:id`, `DELETE /categories/:id`

## transactions

- `POST /transactions` — `{ accountId, categoryId?, amount, type, transferAccountId?, date, memo?, isAuto?, source? }`
  - `type`이 INCOME/EXPENSE/TRANSFER 중 무엇이냐에 따라 계좌 잔액이 자동으로 갱신된다.
- `GET /transactions` — 쿼리: `accountId`, `categoryId`, `type`, `from`, `to`, `skip`, `take`
- `GET /transactions/:id`
- `PATCH /transactions/:id` — 계좌/금액/타입을 바꾸면 기존 잔액 반영분을 되돌리고 새로 반영한다.
- `DELETE /transactions/:id` — 삭제 시 해당 거래의 잔액 반영분을 되돌린다.

## budgets

- `POST /budgets` — `{ categoryId, amount, period, startDate }` (categoryId는 EXPENSE 카테고리만 가능)
- `GET /budgets`, `GET /budgets/:id` — `periodStart`/`periodEnd`/`spent`/`remaining`/`usageRate` 포함
- `PATCH /budgets/:id`, `DELETE /budgets/:id`

## uploads

- `POST /uploads` — `multipart/form-data`, 필드명 `file` (CSV, 최대 5MB)
  - CSV 헤더: `date,type,amount,memo,category` (`memo`, `category`는 선택)
  - `type`은 `INCOME`/`EXPENSE`만 지원, `category`는 이름이 같은(대소문자 무시) 기존 카테고리와 자동 매칭
  - 업로드 시 `UploadBatch`(status=PENDING) + 파싱된 행(`UploadRow`)만 생성되고, 아직 거래는 만들어지지 않는다.
- `GET /uploads`, `GET /uploads/:id` — `:id`는 파싱된 행(`rows`) 포함
- `POST /uploads/:id/confirm` — `{ accountId }` → 행들을 실제 transactions로 일괄 생성하고 계좌 잔액 반영, batch를 CONFIRMED로 변경
- `POST /uploads/:id/cancel` — batch를 CANCELLED로 변경(거래 생성 안 함)

## 참고

- 모든 금액(`amount`, `balance`)은 `BigInt`(원 단위 정수)로 저장되며,
  응답 직렬화 시 문자열로 변환된다 ([main.ts](src/main.ts) 참고).
- `UploadRow`는 최초 스펙에는 없었지만, 업로드 확정 전까지 파싱된 행을 보관할 곳이 필요해서
  추가한 보조 테이블이다 ([schema.prisma](prisma/schema.prisma) 참고). 스키마가 바뀌었으니
  로컬에서 `npm run prisma:migrate`를 다시 실행해야 한다.
