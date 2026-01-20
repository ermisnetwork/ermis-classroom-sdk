# VCR Integration SDK (API Key) – `@ermisnetwork/vcr-client`

TypeScript SDK cho VCR API dùng **API Key** (header `x-api-key`). Hỗ trợ quản lý **Events**, **Registrants** (kèm moderation), **Rewards**, và **Ratings** (read-only).

## Cài đặt

```bash
npm i @ermisnetwork/vcr-client
# hoặc pnpm add @ermisnetwork/vcr-client
# hoặc yarn add @ermisnetwork/vcr-client
```

## Khởi tạo (Authentication)

### Cấu hình

```ts
type Language = 'vi' | 'en';

interface VCRClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
  useAuthorizationHeader?: boolean; // default: false (dùng x-api-key)
  language?: Language; // default: 'vi'
}
```

### Ví dụ khởi tạo

```ts
import { createVCRClient } from '@ermisnetwork/vcr-client';

const client = createVCRClient({
  apiKey: process.env.VCR_API_KEY!,
  baseUrl: 'https://api.vcr.example.com', // optional
  language: 'vi', // optional: 'vi' | 'en'
  // useAuthorizationHeader: true, // optional: dùng Authorization: Bearer thay vì x-api-key
});
```

### Đổi ngôn ngữ response

```ts
client.setLanguage('en');
```

> Ghi chú: SDK tự động thêm query `lang` vào mọi request.

## Types (đầy đủ)

Bạn có thể import type trực tiếp từ package:

```ts
import type {
  // Events
  CreateEventParams,
  UpdateEventParams,
  Event,
  ListEventsParams,
  ParticipantStats,
  EventSettings,
  // Registrants
  CreateRegistrantParams,
  UpdateRegistrantParams,
  Registrant,
  RegistrantRole,
  ListRegistrantsParams,
  BulkCreateRegistrantsParams,
  BulkCreateRegistrantsResult,
  // Rewards
  CreateRewardParams,
  UpdateRewardParams,
  Reward,
  ListRewardsParams,
  // Ratings
  RatingList,
  Rating,
  // Common
  PaginatedResponse,
  ApiResponse,
} from '@ermisnetwork/vcr-client';
```

## API Reference

### Events

- `client.events.create(data: CreateEventParams): Promise<Event>` → `POST /events`
- `client.events.list(params?: ListEventsParams): Promise<PaginatedResponse<Event>>` → `GET /events`
- `client.events.get(eventId: string): Promise<Event>` → `GET /events/:eventId`
- `client.events.update(eventId: string, data: UpdateEventParams): Promise<Event>` → `PATCH /events/:eventId`
- `client.events.delete(eventId: string): Promise<void>` → `DELETE /events/:eventId`
- `client.events.getParticipantStats(eventId: string): Promise<ParticipantStats>` → `GET /events/:eventId/participants/stats`

Ví dụ tạo event (đúng type):

```ts
const payload: CreateEventParams = {
  title: 'Math 101',
  startTime: '2026-01-15T09:00:00Z',
  endTime: '2026-01-15T10:00:00Z',
  settings: {
    recordingEnabled: true,
    chatEnabled: true,
  } satisfies EventSettings,
};

const event = await client.events.create(payload);
```

### Registrants (Attendees + Moderation)

- `client.registrants.create(eventId: string, data: CreateRegistrantParams): Promise<Registrant>` → `POST /events/:eventId/registrants`
- `client.registrants.bulkCreate(eventId: string, payload: BulkCreateRegistrantsParams): Promise<BulkCreateRegistrantsResult>` → `POST /events/:eventId/registrants/bulk` (**tối đa 100**)
- `client.registrants.createMock(eventId: string, count: number): Promise<Registrant[]>` → `POST /events/:eventId/registrants/mock`
- `client.registrants.list(eventId: string, params?: ListRegistrantsParams): Promise<PaginatedResponse<Registrant>>` → `GET /events/:eventId/registrants`
- `client.registrants.update(eventId: string, registrantId: string, data: UpdateRegistrantParams): Promise<Registrant>` → `PATCH /events/:eventId/registrants/:registrantId`
- `client.registrants.delete(eventId: string, registrantId: string): Promise<void>` → `DELETE /events/:eventId/registrants/:registrantId`
- `client.registrants.kick(eventId: string, registrantId: string, reason?: string): Promise<Registrant>` → `POST /events/:eventId/registrants/:registrantId/kick`
- `client.registrants.ban(eventId: string, registrantId: string, reason?: string): Promise<Registrant>` → `POST /events/:eventId/registrants/:registrantId/ban`
- `client.registrants.unban(eventId: string, registrantId: string): Promise<Registrant>` → `POST /events/:eventId/registrants/:registrantId/unban`

Ví dụ tạo registrant:

```ts
const registrantPayload: CreateRegistrantParams = {
  authId: 'user_123',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  role: 'student' satisfies RegistrantRole,
};

const r = await client.registrants.create(event._id, registrantPayload);
```

Ví dụ bulk create (tối đa 100):

```ts
const bulkPayload: BulkCreateRegistrantsParams = {
  registrants: [
    { authId: 'u1', firstName: 'A', lastName: 'One', role: 'student' },
    { authId: 'u2', firstName: 'B', lastName: 'Two', role: 'student' },
  ],
};

const result = await client.registrants.bulkCreate(event._id, bulkPayload);
console.log(result.created, result.failed);
```

### Rewards
> **Ownership**: chỉ **Update/Delete** reward do **API Key của bạn** tạo.

- `client.rewards.create(data: CreateRewardParams): Promise<Reward>` → `POST /event-rewards` (`multipart/form-data`)
- `client.rewards.list(params?: ListRewardsParams): Promise<PaginatedResponse<Reward>>` → `GET /event-rewards`
- `client.rewards.get(rewardId: string): Promise<Reward>` → `GET /event-rewards/:rewardId`
- `client.rewards.update(rewardId: string, data: UpdateRewardParams): Promise<Reward>` → `PATCH /event-rewards/:rewardId` (`multipart/form-data`)
- `client.rewards.delete(rewardId: string): Promise<void>` → `DELETE /event-rewards/:rewardId`

### Ratings (Read-only)
- `client.ratings.list(eventId: string): Promise<RatingList>` → `GET /events/:eventId/ratings`

## Ví dụ end-to-end (ngắn nhưng đầy đủ)

```ts
import { createVCRClient } from '@ermisnetwork/vcr-client';
import type { CreateEventParams, CreateRegistrantParams } from '@ermisnetwork/vcr-client';

const client = createVCRClient({ apiKey: process.env.VCR_API_KEY! });

const eventPayload: CreateEventParams = {
  title: 'Math 101',
  startTime: '2026-01-15T09:00:00Z',
  endTime: '2026-01-15T10:00:00Z',
  settings: { recordingEnabled: true, chatEnabled: true },
};

const event = await client.events.create(eventPayload);

const registrantPayload: CreateRegistrantParams = {
  authId: 'user_123',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  role: 'student',
};

const r = await client.registrants.create(event._id, registrantPayload);
await client.registrants.kick(event._id, r._id, 'Violation');
```

## Ownership & Limitations

- **Ownership**: bạn chỉ **Update/Delete** resources do **API Key của bạn** tạo (đặc biệt là Rewards; Events/Registrants tuỳ backend rule).
- **Không hỗ trợ qua API Key**: breakout rooms, các in-room actions (phát thưởng trong phòng, timer, whiteboard, thay đổi quyền realtime…), và các endpoint cần user session context.

## Error handling

```ts
import { AuthenticationError, PermissionError, NotFoundError, RateLimitError, ServerError } from '@ermisnetwork/vcr-client';

try {
  await client.events.get('bad-id');
} catch (e) {
  if (e instanceof AuthenticationError) {/* 401 */}
  if (e instanceof PermissionError) {/* 403 */}
  if (e instanceof NotFoundError) {/* 404 */}
  if (e instanceof RateLimitError) {/* 429 */}
  if (e instanceof ServerError) {/* 5xx */}
}
```

## License

MIT
