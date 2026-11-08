# Virgool Backend

Backend API for a Persian blogging/content platform. The service is built with NestJS, Express, TypeORM, and PostgreSQL. It provides OTP-based authentication, user profiles and follow relationships, categories, blog posts, comments, likes, bookmarks, and image uploads.

## Tech stack

- NestJS 12 / TypeScript
- Express
- TypeORM with PostgreSQL
- JWT authentication with `@nestjs/jwt`
- `class-validator` request validation
- Multer file uploads served from `public/`
- Swagger/OpenAPI in non-production environments
- Kavenegar HTTP integration for SMS verification

## Project structure

```text
src/
  main.ts                         # App bootstrap, CORS, validation, cookies, Swagger, /health
  config/
    typeorm.config.ts             # Runtime TypeORM configuration
    typeorm.ts                    # TypeORM CLI datasource for migrations
    swagger.config.ts             # Swagger document setup
  common/
    decorators/                   # Auth, role, pagination, upload decorators
    dtos/                         # Shared pagination DTO
    enums/                        # Roles, cookies, entity names, messages
    middleware/                   # Optional authenticated-user middleware
    utils/                        # Pagination, slug, cookie, Multer helpers
  modules/
    app/                          # Root Nest module
    auth/                         # OTP auth, JWT tokens, guards
    user/                         # Users, profiles, OTP records, follows
    category/                     # Blog categories
    blog/                         # Blogs, categories relation, likes, bookmarks, comments
    image/                        # Uploaded image metadata
    http/                         # Kavenegar SMS service
public/uploads/                   # Files written by Multer and served statically
```

## Requirements

- Node.js `>=22.22.3` (declared in `package.json`)
- npm
- PostgreSQL

## Configuration

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

The application reads `.env` through `ConfigModule`. The important variables are:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Defaults to `3000`. |
| `NODE_ENV` | When not `production`, Swagger is mounted at `/swagger`. |
| `ENVIRONMENT` | When exactly `DEVELOPMENT`, TypeORM `synchronize` is enabled. |
| `CORS_ORIGIN` | Comma-separated allowed origins. If unset, CORS origin defaults to `true`. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | PostgreSQL connection settings. |
| `COOKIE_SECRET` | Secret passed to `cookie-parser`. Defaults to `default-cookie-secret`. |
| `OTP_TOKEN_SECRET` | Secret for short-lived OTP JWTs stored in the `otp` cookie. |
| `ACCESS_TOKEN_SECRET` | Secret for long-lived bearer access tokens. |
| `EMAIL_TOKEN_SECRET` | Secret for email-change OTP binding tokens. |
| `PHONE_TOKEN_SECRET` | Secret for phone-change OTP binding tokens. |
| `SEND_SMS_URL` | Kavenegar verification SMS endpoint. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET_ID` | Present for the Google strategy, but Google auth is currently not registered. |

`BACKEND_URL` and `FRONTEND_URL` exist in `.env.example` and the environment typings, but the current runtime code does not read them directly.

> `NODE_ENV` and `ENVIRONMENT` are different switches: `NODE_ENV` controls Swagger visibility, while `ENVIRONMENT=DEVELOPMENT` controls TypeORM schema synchronization.

## Installation and running

```bash
npm install
npm run build
npm run start
```

Other scripts:

```bash
# Watch mode for development
npm run start:dev

# Debug watch mode
npm run start:debug

# Run the compiled app from dist/
npm run start:prod

# TypeORM CLI
npm run typeorm -- <typeorm-command>
npm run migration:run
npm run migration:revert
npm run migration:generate --name=<MigrationName>
npm run migration:create --name=<MigrationName>

# Format source files
npm run format
```

There is no `test` script in `package.json`, and the repository currently has no Jest spec/test files.

After startup:

- API: `http://localhost:3000`
- Health check: `http://localhost:3000/health`
- Swagger UI: `http://localhost:3000/swagger` when `NODE_ENV` is not `production`

The health endpoint returns:

```json
{
  "status": "ok",
  "timestamp": "2026-11-08T00:00:00.000Z"
}
```

## Authentication model

The API uses JWTs for two main authentication purposes, plus short-lived binding tokens for contact changes:

1. **OTP token**
   - Created after `POST /auth/user-existence`.
   - Sent as an HTTP-only `otp` cookie.
   - Expires in 2 minutes.
   - Used only by `POST /auth/check-otp`.

2. **Access token**
   - Returned by `POST /auth/check-otp`.
   - Sent by clients as `Authorization: Bearer <token>`.
   - Expires in 1 year.
   - `AuthGuard` verifies the JWT, loads the user from the database, attaches it to `request.user`, and rejects users whose status is `block`.

`AuthDecorator()` applies both `AuthGuard` and `RoleGuard`. `CanAccess(...)` stores required roles in metadata; admins bypass role checks, and non-admin users must match one of the required roles. Currently only `POST /user/block` declares `CanAccess(Roles.Admin)`.

### OTP login/register flow

`POST /auth/user-existence` accepts:

```json
{
  "type": "login",
  "method": "phone",
  "username": "09120000000"
}
```

- `type` can be `login` or `register`.
- `method` can be `username`, `email`, or `phone`.
- For `login`, the account must already exist.
- For `register`, email and phone are supported. A new user is created and assigned a generated username in the form `m_<userId>`.
- Registering with `method=username` is rejected.
- The service generates a 5-digit numeric OTP, stores or updates the user's single OTP record, expires it after 2 minutes, and places the OTP JWT in the `otp` cookie.
- The JSON response currently includes the generated `code` directly.

`POST /auth/check-otp` accepts:

```json
{
  "code": "12345"
}
```

It reads the `otp` cookie, verifies the OTP token, checks the stored OTP code and expiry, and returns an access token:

```json
{
  "message": "با موفقیت وارد حساب کاربری خود شدید",
  "accessToken": "<jwt>"
}
```

`GET /auth/check-login` is protected and returns the authenticated `request.user` object.

### Current OTP behavior notes

- `KavenegarService.sendVerificationSms()` exists, but the `sendOtp()` calls in `AuthService.userExistence()` are commented out, so SMS is not actually sent by the current auth flow.
- Email OTP delivery is still a TODO in `sendOtp()`.
- `checkOtp()` sets `verify_email=true` for both email and phone OTP methods; it does not set `verify_phone` on that path.
- OTP records are not deleted after successful verification, so a valid code can be reused until it expires.

### Contact-change OTP flows

Changing email or phone uses the same OTP table but separate binding cookies:

- `PATCH /user/change-email` stores the requested address in `new_email`, creates an OTP, returns the code, and sets an HTTP-only `email-otp` cookie containing a JWT for that email.
- `POST /user/verify-email-otp` verifies the cookie email against `new_email`, validates the OTP code/method, then copies the new email into `email`, sets `verify_email=true`, and clears `new_email`.
- `PATCH /user/change-phone` and `POST /user/verify-phone-otp` follow the same pattern with `new_phone`, the `phone-otp` cookie, `verify_phone=true`, and `phone`.

## API overview

### Public endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness check. |
| POST | `/auth/user-existence` | Starts login/register OTP flow. |
| POST | `/auth/check-otp` | Verifies OTP cookie/code and returns access token. |
| GET | `/category` | Paginated category list. |
| POST | `/category` | Create category. Currently unauthenticated. |
| GET | `/category/:id` | Get one category. |
| PATCH | `/category/:id` | Update category. Currently unauthenticated. |
| DELETE | `/category/:id` | Delete category. Currently unauthenticated. |
| GET | `/blog` | Paginated public blog list with optional filters. |
| GET | `/blog/by-slug/:slug` | Public blog detail by slug. |

`GET /blog/by-slug/:slug` uses `AddUserToReqWOV` middleware: if a valid bearer token is supplied, the user is attached to the request so the response can include `isLiked` and `isBookmarked`; invalid or missing tokens are ignored for this public route.

### User endpoints

All routes below are under `/user` and require `AuthDecorator()` (`AuthGuard` + `RoleGuard`).

| Method | Path | Description |
| --- | --- | --- |
| PUT | `/user/profile` | Update profile and optionally upload profile/background images. Multipart form data. |
| GET | `/user/profile` | Get current user with profile and follower/following counts. |
| GET | `/user/list` | Paginated list of users. |
| GET | `/user/followers` | Paginated users following the current user. |
| GET | `/user/following` | Paginated users followed by the current user. |
| GET | `/user/follow/:followingId` | Toggle follow/unfollow for another user. |
| PATCH | `/user/change-email` | Start email-change OTP flow. |
| POST | `/user/verify-email-otp` | Verify email-change OTP and update email. |
| PATCH | `/user/change-phone` | Start phone-change OTP flow. |
| POST | `/user/verify-phone-otp` | Verify phone-change OTP and update phone. |
| POST | `/user/block` | Toggle block status. Requires `Roles.Admin`. |
| PATCH | `/user/change-username` | Change username after uniqueness check. |

Profile fields accepted by `PUT /user/profile`:

- `nick_name`
- `bio`
- `gender` (`مرد`, `زن`, or `سایر`)
- `birthday`
- `x_profile`
- `linkedin_profile`
- `image_profile` file field
- `bg_image` file field

Only truthy values update an existing profile. If no profile exists, one is created and linked to the user through `profileId`.

`GET /user/follow/:followingId` mutates follow state even though it uses `GET`.

### Image endpoints

All `/image` routes require authentication.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/image` | Upload image metadata and file. Multipart field name: `image`. |
| GET | `/image` | List images owned by the current user. |
| GET | `/image/:id` | Get one image owned by the current user. |
| DELETE | `/image/:id` | Delete one image owned by the current user. |

Accepted extensions are `.png`, `.jpg`, and `.jpeg`. Files are stored under `public/uploads/images/` by default and served through the static `public/` directory.

### Category behavior

- Category titles are trimmed and lowercased when checking for duplicates during creation.
- `PATCH /category/:id` assigns a supplied title directly and does not perform the same duplicate/normalization check as creation.
- `priority` is optional.
- `GET /category` supports `page` and `limit` query parameters.
- Category create/update/delete routes do not currently have an auth decorator, so they are publicly reachable.

### Blog endpoints

`POST /blog`, `GET /blog/my`, like/bookmark/delete/update routes require authentication. `GET /blog` and `GET /blog/by-slug/:slug` are public.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/blog` | Create blog post and attach categories. |
| GET | `/blog/my` | List blogs authored by the current user, newest first. |
| GET | `/blog` | Public paginated blog list. |
| GET | `/blog/by-slug/:slug` | Blog detail, comments, user flags, and suggested blogs. |
| GET | `/blog/like/:id` | Toggle like for a blog. |
| GET | `/blog/bookmark/:id` | Toggle bookmark for a blog. |
| PUT | `/blog/:id` | Update blog fields and categories. |
| DELETE | `/blog/:id` | Delete a blog. |

`GET /blog/like/:id` and `GET /blog/bookmark/:id` mutate state even though they use `GET`.

`GET /blog` supports:

- `page`
- `limit`
- `category`
- `search`

Search uses a case-insensitive `ILIKE` match across `title`, `description`, and `content`. The response includes relation counts for likes, bookmarks, and accepted comments.

`GET /blog/by-slug/:slug` returns:

- the blog with author username/nickname and categories
- `isLiked` and `isBookmarked` for an authenticated caller
- paginated comments for the blog
- three randomly selected suggested blogs generated by a raw SQL query

### Blog creation/update behavior

`POST /blog` accepts fields including:

- `title`
- `slug` (optional)
- `description`
- `content`
- `image`
- `time_for_study`
- `categories`

Behavior:

- `categories` may be an array or a comma-separated string.
- Missing categories are created automatically by title.
- Slug is generated from `slug` or `title`; collisions get a random suffix.
- New blogs are always created with `status="draft"`.
- There is currently no endpoint that changes blog status to `published`.

`PUT /blog/:id` updates supplied fields and replaces category relations. As currently implemented, `categories` is effectively required by the service even though the DTO is a partial type.

### Comment endpoints

All `/blog-comment` routes require `AuthGuard`.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/blog-comment` | Create a comment or reply. |
| GET | `/blog-comment` | Paginated list of all comments. |
| PUT | `/blog-comment/accept/:id` | Mark a comment as accepted. |
| PUT | `/blog-comment/reject/:id` | Mark a comment as rejected. |

Comment creation accepts `text`, `blogId`, and optional `parentId`. New comments are stored with `accepted=true`. `parentId` is only retained if the referenced parent comment exists.

## Pagination

List endpoints accept:

- `page`: 1-based page number. Missing, `0`, or values `<= 1` are treated as page 1.
- `limit`: page size. Defaults to `10` when missing or non-positive.

Paginated responses use this shape:

```json
{
  "pagination": {
    "totalCount": 100,
    "page": 1,
    "limit": 10,
    "pageCount": 10
  },
  "blogs": []
}
```

The data key varies by endpoint (`users`, `followers`, `following`, `categories`, `blogs`, `comments`).

## Database model

TypeORM entities map to these tables:

- `user`: account identifiers, role, status, verification flags, OTP/profile references
- `profile`: nickname, bio, images, gender, birthday, social links
- `otp`: OTP code, expiry, method, and user relation
- `follow`: follower/following relationship
- `category`: title and priority
- `blog`: title, slug, description, content, image, study time, status, author
- `blog_category`: blog-category relation
- `blog_likes`: user-blog like relation
- `blog_bookmarks`: user-blog bookmark relation
- `blog_comments`: threaded comments with accepted flag
- `image`: uploaded image metadata

Most entities use an auto-increment numeric `id` from `BaseEntity`.

## File uploads

Multer writes files below `public/uploads/`:

- Profile images: `public/uploads/user-profile/`
- Blog/general image uploads: `public/uploads/images/`

Only `.png`, `.jpg`, and `.jpeg` extensions are accepted. Generated filenames are timestamp-based. `main.ts` serves `public/` as static assets, so files are reachable under `/uploads/...`.

The `image` table's `location` field is decorated by `@AfterLoad` and currently prefixes stored paths with `http://localhost:3000/`, regardless of `PORT` or `BACKEND_URL`.

## Database migrations

Runtime TypeORM config does not run migrations automatically:

- `ENVIRONMENT=DEVELOPMENT` enables `synchronize`, so TypeORM can update the schema directly.
- Other environments use `synchronize=false`, so schema changes must come from migrations or manual SQL.

The repository includes one TypeORM migration and CLI scripts for generating/running migrations. Review existing migrations before relying on them for a fresh production database because entity definitions have evolved beyond the initial migration.

## Current implementation notes

These are behaviors present in the code today, not necessarily intended product behavior:

- OTP codes are returned in API responses while SMS delivery is disabled.
- Access tokens have a 1-year lifetime.
- Category create/update/delete endpoints are unauthenticated.
- Public blog listing does not filter by `status`, so drafts can appear in `GET /blog`.
- Blog update/delete and comment accept/reject do not currently verify ownership or admin permission.
- `GET /blog` counts only accepted comments, but the comment pagination inside `GET /blog/by-slug/:slug` does not filter by `accepted`, so rejected comments can still appear in blog detail responses.
- User profile, user list, and `GET /auth/check-login` responses return TypeORM user entities without a response DTO or serializer, so populated fields such as `password`, `otpId`, `new_email`, and `new_phone` can be exposed.
- Google auth controller/strategy files exist, but `GoogleAuthController` and `GoogleStrategy` are commented out in `AuthModule`, so those routes are inactive.
- `ImageEntity.location` hardcodes `http://localhost:3000/`.
- Error and success messages are Persian strings from `src/common/enums/message.enum.ts`.

## Verification

The project currently supports:

```bash
npm run build
```

No automated test suite is configured at present.
